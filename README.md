# Filet CLI

**Filet** is a lightweight command-line tool designed for instant, secure, and direct file sharing. It allows you to generate a public URL for any local file on your machine so that someone else can download it directly from you, without ever uploading the file to a third-party server.

## Technologies Used

*   **Node.js**: The core runtime environment.
*   **Express.js**: A lightweight HTTP server used to serve the file directly from your local filesystem.
*   **Localtunnel (Tunneling/Relay)**: Used to expose your local server to the public internet. It creates a secure tunnel between your machine and a public URL, acting as a **relay** to bypass NAT and firewalls.
*   **Direct Streaming**: The file is streamed directly from your disk to the receiver's browser, ensuring no data is stored permanently on any intermediate server.
*   **ES Modules**: Built using modern JavaScript standards for better performance and maintainability.

## How it Works
1.  You run `filet <path>`.
2.  A local web server starts and picks a random port.
3.  A tunnel is established to a public URL (e.g., `https://random-words.loca.lt`).
4.  When someone visits the URL, the request is relayed to your local server, which streams the file directly to their device.
