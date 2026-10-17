# CamelKit Hub

Welcome to the **CamelKit Hub**, the official central directory and plugin submission platform for CamelKit (a RuneLite-esque client for EvilQuest). This monorepo powers both the public-facing frontend directory and the robust backend API handling plugin lifecycle management.

## 🏗️ Architecture

This repository is structured as a Yarn monorepo containing two main packages:

### `@camelkit/web` (Frontend)
Located in `packages/web`, the frontend is built using **Astro** for lightning-fast static and dynamic rendering, paired with **Svelte** for highly interactive components. It features a bespoke retro dark fantasy design aesthetic tailored to match EvilQuest's immersive world.

Key Features:
- **Public Plugin Directory:** Browse all officially approved CamelKit plugins.
- **Developer Dashboard:** Authenticated developers can submit new plugins and sync remote repository updates.
- **Admin Dashboard:** Admins can review, approve, or reject pending plugin submissions from the community.

### `@camelkit/api` (Backend)
Located in `packages/api`, the backend is a serverless application built on **Cloudflare Workers**. It acts as the secure bridge between the frontend application, our database, and external integrations.

Key Features:
- **Plugin Lifecycle Management:** Handles the submission queue, admin approvals/rejections, and version syncing.
- **GitHub Integrations:** Uses GitHub OAuth for secure user authentication. It also automatically dispatches webhook events to the `CamelC0re/Plugin-Builder` repository to compile and bundle submitted plugins.
- **Cloudflare R2 Storage:** Manages the staging and storage of plugin source code (`.zip` files) downloaded from user repositories.
- **Cloudflare D1 Database:** Persists user data, plugin metadata, and submission queues globally at the edge.

## 🚀 Getting Started

### Prerequisites
- Node.js (v18 or higher)
- [Yarn](https://yarnpkg.com/) (v4.x)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) for Cloudflare local development

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/CamelC0re/Hub.git
   cd Hub
   ```

2. **Install dependencies:**
   ```bash
   yarn install
   ```

### Running Locally

You can run both the frontend web app and the backend API server concurrently using the root package scripts:

- **Start the API Server (Cloudflare Worker Local Emulator):**
  ```bash
  yarn api
  ```
  *The backend will run on `http://localhost:8787`.*

- **Start the Web Frontend:**
  ```bash
  yarn web
  ```
  *The frontend will run on `http://localhost:4321`.*

## 🔒 Environment Variables

To run the full stack locally, you'll need the appropriate `.env` or `.dev.vars` files configured in your workspaces.

**Backend (`packages/api/.dev.vars`):**
Requires GitHub OAuth client credentials, database bindings, and R2 storage bucket configurations.

**Frontend (`packages/web/.env`):**
Requires the public API URL (defaults to `http://localhost:8787` in development) and any public-facing OAuth keys.

## 🤝 Contributing
Contributions to the CamelKit Hub are always welcome! If you'd like to improve the directory UI, add new developer tools, or enhance the backend API, please feel free to open a pull request. 

For the actual CamelKit Client, refer to the [Client](https://github.com/CamelC0re/Client) repository.

## 📜 License
© 2026 CamelKit. All Rights Reserved.

This repository is publicly visible for transparency and to allow contributions to the official CamelKit project, but it is **not** open-source software. You are not permitted to copy, distribute, modify, or use this code for any other projects without explicit permission.
