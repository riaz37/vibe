# You can use most Debian-based base images
FROM node:22-slim

# Install curl and process management tools
RUN apt-get update && apt-get install -y curl procps && apt-get clean && rm -rf /var/lib/apt/lists/*

# Set Node.js memory options to prevent bus errors
ENV NODE_OPTIONS="--max-old-space-size=2048 --no-experimental-fetch"

COPY compile_page.sh /compile_page.sh
RUN chmod +x /compile_page.sh

# Install dependencies and customize sandbox
WORKDIR /home/user/nextjs-app

RUN npx --yes create-next-app@15.3.3 . --yes

RUN npx --yes shadcn@2.6.3 init --yes -b neutral --force
RUN npx --yes shadcn@2.6.3 add --all --yes

# Move the Nextjs app to the home directory and remove the nextjs-app directory
RUN mv /home/user/nextjs-app/* /home/user/ && rm -rf /home/user/nextjs-app

# Create a startup script that ensures the server stays running
RUN echo '#!/bin/bash\n\
cd /home/user\n\
echo "Starting Next.js development server..."\n\
# Kill any existing processes first\n\
pkill -f "next dev" || true\n\
pkill -f "node.*next" || true\n\
sleep 2\n\
# Start with memory-safe options\n\
exec npm run dev -- --turbopack' > /start-server.sh && chmod +x /start-server.sh

EXPOSE 3000
CMD ["/start-server.sh"]