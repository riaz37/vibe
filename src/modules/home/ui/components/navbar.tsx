"use client";

import { Button } from "@/components/ui/button";
import { UserControl } from "@/components/user-control";
import { useScroll } from "@/hooks/use-scroll";
import { cn } from "@/lib/utils";
import { SignedIn, SignedOut, SignInButton, SignUpButton } from "@clerk/nextjs";
import Image from "next/image";
import Link from "next/link";

export function Navbar() {
    const isScrolled = useScroll();

    return (
        <nav
            className={cn(
                "p-4 bg-transparent fixed top-0 left-0 right-0 z-50 transition-all duration-200 border-b border-transparent",
                isScrolled && "bg-background border-border"
            )}
        >
            <div className="max-w-5xl mx-auto w-full flex justify-between items-center">
                <Link href="/" className="flex items-center gap-2">
                    <Image
                        src="/logo.svg"
                        alt="Vibe"
                        width={38}
                        height={38}
                    />

                    <span className="font-semibold text-lg">Vibe</span>
                </Link>

                <SignedOut>
                    <div className="flex gap-2">
                        <SignUpButton>
                            <Button variant="outline" size="sm">
                                Sign Up
                            </Button>
                        </SignUpButton>

                        <SignInButton>
                            <Button size="sm">
                                Sign In
                            </Button>
                        </SignInButton>
                    </div>
                </SignedOut>

                <SignedIn>
                    <UserControl showName />
                </SignedIn>
            </div>
        </nav>
    )
}