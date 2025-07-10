import prisma from "@/lib/db";
import { lastAssistantMessageContent } from "@/lib/utils";
import { FRAGMENT_TITLE_PROMPT, PROMPT, RESPONSE_PROMPT } from "@/prompt";
import { Sandbox } from "@e2b/code-interpreter";
import { createAgent, createNetwork, createState, createTool, gemini, type Message, type Tool } from "@inngest/agent-kit";
import { z } from "zod";
import { inngest } from "./client";
import { getSandbox } from "./utils";
import { SANDBOX_TIMEOUT } from "./types";
import { debugSandbox, fixSandboxIssues } from "./debug";

interface AgentState {
    summary: string;
    files: { [path: string]: string };
}

export const codeAgentFunction = inngest.createFunction(
    { id: "code-agent" },
    { event: "code-agent/run" },
    async ({ event, step }) => {
        const sandboxId = await step.run("get-sandbox", async () => {
            const sandbox = await Sandbox.create("zyro-nextjs-riaz302001");
            await sandbox.setTimeout(SANDBOX_TIMEOUT);
            return sandbox.sandboxId;
        });

        const previousMessage = await step.run("get-previous-message", async () => {
            const formattedMessage: Message[] = []

            const messages = await prisma.message.findMany({
                where: {
                    projectId: event.data.projectId
                },
                orderBy: {
                    createdAt: "desc"
                },
                take: 5
            })

            for (const message of messages) {
                if (!message.content) continue;

                formattedMessage.push({
                    type: "text",
                    role: message.role === "ASSISTANT" ? "assistant" : "user",
                    content: message.content
                })
            }

            return formattedMessage.reverse();
        })

        const state = createState<AgentState>(
            {
                summary: "",
                files: {}
            },
            {
                messages: previousMessage
            }
        )

        const codeAgent = createAgent<AgentState>({
            name: "code-agent",
            description: "An expert code agent",
            system: PROMPT,
            model: gemini({
                model: "gemini-2.0-flash"
            }),
            tools: [
                createTool({
                    name: "terminal",
                    description: "Use the terminal to run commands",
                    parameters: z.object({
                        command: z.string(),
                    }),
                    handler: async ({ command }, { step }) => {
                        return await step?.run("terminal", async () => {
                            const buffers = { stdout: "", stderr: "" };

                            try {
                                const sandbox = await getSandbox(sandboxId);
                                const result = await sandbox.commands.run(command, {
                                    onStdout: (data: string) => {
                                        buffers.stdout += data;
                                    },
                                    onStderr: (data: string) => {
                                        buffers.stderr += data;
                                    }
                                })

                                return result.stdout;
                            } catch (error) {
                                console.error(
                                    `Command failed: ${error} \n stdout: ${buffers.stdout} \n stderr: ${buffers.stderr}`
                                );
                            }
                        })
                    }
                }),
                createTool({
                    name: "createOrUpdateFile",
                    description: "Create or update a file in the sandbox",
                    parameters: z.object({
                        files: z.array(
                            z.object({
                                path: z.string(),
                                content: z.string(),
                            }),
                        )
                    }),
                    handler: async ({ files }, { step, network }: Tool.Options<AgentState>) => {
                        const newFiles = await step?.run("createOrUpdateFile", async () => {
                            try {
                                const updateFiles = network.state.data.files || {}
                                const sandbox = await getSandbox(sandboxId);
                                for (const file of files) {
                                    await sandbox.files.write(file.path, file.content);
                                    updateFiles[file.path] = file.content
                                }

                                return updateFiles
                            } catch (error) {
                                return "Error: " + error
                            }
                        })

                        if (typeof newFiles === "object") {
                            network.state.data.files = newFiles
                        }
                    }
                }),
                createTool({
                    name: "readFile",
                    description: "Read a file from the sandbox",
                    parameters: z.object({
                        files: z.array(z.string()),
                    }),
                    handler: async ({ files }, { step }) => {
                        return await step?.run("readFile", async () => {
                            try {
                                const sandbox = await getSandbox(sandboxId);
                                const contents = []
                                for (const file of files) {
                                    const fileContent = await sandbox.files.read(file)
                                    contents.push({ path: file, content: fileContent })
                                }

                                return JSON.stringify(contents)
                            } catch (error) {
                                return "Error: " + error
                            }
                        })
                    }
                }),
                createTool({
                    name: "restartNextServer",
                    description: "Restart the Next.js development server in the sandbox",
                    parameters: z.object({}),
                    handler: async ({}, { step }) => {
                        return await step?.run("restartNextServer", async () => {
                            try {
                                const fixed = await fixSandboxIssues(sandboxId);
                                return fixed ? "Next.js server restarted successfully" : "Failed to restart Next.js server";
                            } catch (error) {
                                return "Error restarting server: " + error
                            }
                        })
                    }
                }),
                createTool({
                    name: "checkSandboxHealth",
                    description: "Check the health and status of the sandbox environment",
                    parameters: z.object({}),
                    handler: async ({}, { step }) => {
                        return await step?.run("checkSandboxHealth", async () => {
                            try {
                                const debugInfo = await debugSandbox(sandboxId);
                                return JSON.stringify(debugInfo, null, 2);
                            } catch (error) {
                                return "Error checking sandbox health: " + error
                            }
                        })
                    }
                })
            ],
            lifecycle: {
                onResponse: async ({ result, network }) => {
                    const lastAssistantTextMessageText = lastAssistantMessageContent(result);

                    if (lastAssistantTextMessageText && network) {
                        if (lastAssistantTextMessageText.includes("<task_summary>")) {
                            network.state.data.summary = lastAssistantTextMessageText
                        }
                    }

                    return result
                },
            }
        });

        const network = createNetwork<AgentState>({
            name: "codding-agent-network",
            agents: [codeAgent],
            maxIter: 15,
            defaultState: state,
            router: async ({ network }) => {
                const summary = network.state.data.summary

                if (summary) {
                    return;
                }

                return codeAgent;
            }
        })

        const result = await network.run(event.data.value, { state })


        const fragmentTitleGenerator = createAgent({
            name: "fragment-title-generator",
            description: "A fragment title generator",
            system: FRAGMENT_TITLE_PROMPT,
            model: gemini({
                model: "gemini-1.5-flash"
            }),
        });

        const responseGenerator = createAgent({
            name: "response-generator",
            description: "A response generator",
            system: RESPONSE_PROMPT,
            model: gemini({
                model: "gemini-1.5-flash"
            }),
        });

        const { output: fragmentTitleOutput } = await fragmentTitleGenerator.run(result.state.data.summary);
        const { output: responseOutput } = await responseGenerator.run(result.state.data.summary);

        const generateFragmentTitle = () => {
            const firstOutput = fragmentTitleOutput[0];

            if (firstOutput.type === "text") {
                return firstOutput.content || "Fragment";
            }

            if (firstOutput.type === "tool_result") {
                const content = firstOutput.content;
                if (Array.isArray(content)) {
                    return content[0]?.content || "Fragment";
                }
                return content || "Fragment";
            }

            return "Fragment";
        };

        const generateResponse = () => {
            const firstOutput = responseOutput[0];

            if (firstOutput.type === "text") {
                return firstOutput.content || "Here you go!";
            }

            if (firstOutput.type === "tool_result") {
                const content = firstOutput.content;
                if (Array.isArray(content)) {
                    return content[0]?.content || "Here you go!";
                }
                return content || "Here you go!";
            }

            return "Here you go!";
        };


        const isError =
            !result.state.data.summary ||
            Object.keys(result.state.data.files).length === 0

        const sandboxUrl = await step.run("get-sandbox-url", async () => {
            try {
                const sandbox = await getSandbox(sandboxId);

                // Check if Next.js server is running by testing the port
                const checkServerResult = await sandbox.commands.run("curl -s -o /dev/null -w '%{http_code}' http://localhost:3000", {
                    timeoutMs: 5000
                });

                console.log(`Server check result: ${checkServerResult.stdout}`);

                // If server is not responding (not 200), try to start it
                if (checkServerResult.stdout.trim() !== "200") {
                    console.log("Next.js server not responding, attempting to start...");

                    // Kill any existing Next.js processes
                    await sandbox.commands.run("pkill -f 'next dev' || true");
                    await sandbox.commands.run("pkill -f 'node.*next' || true");

                    // Wait a moment for processes to terminate
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    // Start Next.js server in background
                    await sandbox.commands.run("cd /home/user && nohup npm run dev > /tmp/nextjs.log 2>&1 &");

                    // Wait for server to start and check again
                    let attempts = 0;
                    const maxAttempts = 30; // 30 seconds max

                    while (attempts < maxAttempts) {
                        await new Promise(resolve => setTimeout(resolve, 1000));

                        const serverCheck = await sandbox.commands.run("curl -s -o /dev/null -w '%{http_code}' http://localhost:3000", {
                            timeoutMs: 3000
                        });

                        if (serverCheck.stdout.trim() === "200") {
                            console.log(`Server started successfully after ${attempts + 1} attempts`);
                            break;
                        }

                        attempts++;

                        if (attempts === maxAttempts) {
                            // Use debug utility to get comprehensive info
                            console.error(`Failed to start Next.js server after ${maxAttempts} attempts. Running diagnostics...`);
                            await debugSandbox(sandboxId);

                            // Try to fix the issues
                            const fixed = await fixSandboxIssues(sandboxId);
                            if (!fixed) {
                                throw new Error("Unable to start Next.js server in sandbox");
                            }
                        }
                    }
                }

                const host = sandbox.getHost(3000);
                return `http://${host}`;
            } catch (error) {
                console.error("Error getting sandbox URL:", error);
                // Return a fallback URL or re-throw based on your needs
                throw error;
            }
        });

        await step.run("save-result", async () => {
            if (isError) {
                console.error(result.state.data.summary)
                return await prisma.message.create({
                    data: {
                        projectId: event.data.projectId,
                        content: "Something went wrong. Please try again.",
                        role: "ASSISTANT",
                        type: "ERROR",
                    }
                })
            }

            return prisma.message.create({
                data: {
                    projectId: event.data.projectId,
                    content: generateResponse(),
                    role: "ASSISTANT",
                    type: "RESULT",
                    Fragment: {
                        create: {
                            sandboxUrl: sandboxUrl,
                            title: generateFragmentTitle(),
                            files: result.state.data.files
                        }
                    }
                }
            })
        })

        return {
            url: sandboxUrl,
            title: "Fragment",
            files: result.state.data.files,
            summary: result.state.data.summary
        };
    }
);
