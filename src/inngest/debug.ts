import { Sandbox } from "@e2b/code-interpreter";
import { getSandbox } from "./utils";

/**
 * Debug utility to check sandbox health and diagnose issues
 */
export async function debugSandbox(sandboxId: string) {
    try {
        const sandbox = await getSandbox(sandboxId);
        
        console.log(`=== Debugging Sandbox ${sandboxId} ===`);
        
        // Check if sandbox is alive
        const uptimeResult = await sandbox.commands.run("uptime");
        console.log("Sandbox uptime:", uptimeResult.stdout);
        
        // Check running processes
        const processResult = await sandbox.commands.run("ps aux | grep -E '(next|node|npm)' | grep -v grep");
        console.log("Running Node/Next processes:", processResult.stdout || "None found");
        
        // Check port 3000
        const portResult = await sandbox.commands.run("netstat -tlnp | grep :3000 || ss -tlnp | grep :3000");
        console.log("Port 3000 status:", portResult.stdout || "Port not in use");
        
        // Test HTTP connection to localhost:3000
        const httpResult = await sandbox.commands.run("curl -s -o /dev/null -w '%{http_code}' http://localhost:3000", {
            timeout: 5000
        });
        console.log("HTTP response code:", httpResult.stdout || "No response");
        
        // Check Next.js logs if they exist
        const logsResult = await sandbox.commands.run("tail -20 /tmp/nextjs.log 2>/dev/null || echo 'No logs found'");
        console.log("Next.js logs:", logsResult.stdout);
        
        // Check if package.json exists and has dev script
        const packageResult = await sandbox.commands.run("cd /home/user && cat package.json | grep -A5 -B5 '\"dev\"' || echo 'No dev script found'");
        console.log("Package.json dev script:", packageResult.stdout);
        
        // Check current working directory and files
        const pwdResult = await sandbox.commands.run("pwd && ls -la");
        console.log("Current directory and files:", pwdResult.stdout);
        
        console.log("=== End Debug Info ===");
        
        return {
            uptime: uptimeResult.stdout,
            processes: processResult.stdout,
            port: portResult.stdout,
            httpStatus: httpResult.stdout,
            logs: logsResult.stdout,
            packageJson: packageResult.stdout,
            directory: pwdResult.stdout
        };
        
    } catch (error) {
        console.error("Error debugging sandbox:", error);
        throw error;
    }
}

/**
 * Attempt to fix common sandbox issues
 */
export async function fixSandboxIssues(sandboxId: string) {
    try {
        const sandbox = await getSandbox(sandboxId);
        
        console.log(`=== Attempting to fix sandbox ${sandboxId} ===`);
        
        // Kill any hanging processes
        await sandbox.commands.run("pkill -f 'next dev' || true");
        await sandbox.commands.run("pkill -f 'node.*next' || true");
        
        // Wait for processes to terminate
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Ensure we're in the right directory
        await sandbox.commands.run("cd /home/user");
        
        // Check if node_modules exists, if not install dependencies
        const nodeModulesCheck = await sandbox.commands.run("cd /home/user && [ -d node_modules ] && echo 'exists' || echo 'missing'");
        
        if (nodeModulesCheck.stdout.trim() === 'missing') {
            console.log("Installing dependencies...");
            await sandbox.commands.run("cd /home/user && npm install", { timeout: 120000 });
        }
        
        // Start the server
        console.log("Starting Next.js server...");
        await sandbox.commands.run("cd /home/user && nohup npm run dev > /tmp/nextjs.log 2>&1 &");
        
        // Wait and verify server started
        let attempts = 0;
        const maxAttempts = 30;
        
        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const serverCheck = await sandbox.commands.run("curl -s -o /dev/null -w '%{http_code}' http://localhost:3000", {
                timeout: 3000
            });
            
            if (serverCheck.stdout.trim() === "200") {
                console.log(`Server fixed and running after ${attempts + 1} seconds`);
                return true;
            }
            
            attempts++;
        }
        
        console.log("Failed to fix server issues");
        return false;
        
    } catch (error) {
        console.error("Error fixing sandbox:", error);
        return false;
    }
}
