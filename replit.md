# Dealflow Agent

A deal pipeline management dashboard for VCs with a companion Chrome extension. Turn any link into structured deal intelligence with right-click capture and lightweight pipeline management.

## Architecture

- **Frontend:** React + TypeScript + Vite, with shadcn/ui components, TanStack Query, wouter routing
- **Backend:** Express.js API server with CORS enabled for extension access
- **Database:** PostgreSQL with Drizzle ORM
- **Extension:** Chrome Manifest V3 extension with context menu, content scripts, and popup
- **Styling:** Tailwind CSS with Inter font

## Data Model

- **Companies**: Core deal entities with name, one-liner, description, sector, business model, stage, funding history, competitive landscape, source URL, pipeline stage, and tags
- **Founders**: Linked to companies with name, role, bio, LinkedIn/Twitter URLs, prior companies
- **Notes**: Time-stamped notes attached to companies

## Pipeline Stages

`Discovered -> Researching -> Reaching Out -> In Diligence -> Passed / Invested`

## Pages

- `/` - Pipeline (Kanban board with drag-and-drop)
- `/companies` - Companies list/grid view with search and filters
- `/companies/:id` - Company detail with founders, notes, tags, pipeline management
- `/add` - Add new deal form with founder fields
- `/extension` - Browser extension setup instructions

## Chrome Extension (`extension/` folder)

- `manifest.json` - Chrome Manifest V3 config
- `background.js` - Service worker: context menu creation, API calls to dashboard
- `content.js` / `content.css` - Injected into pages: floating confirmation card UI
- `popup.html` / `popup.js` - Extension popup: dashboard URL configuration
- `icons/` - Extension icons

### Extension Flow
1. User right-clicks on any webpage -> "Add to Dealflow"
2. Background script extracts URL, infers company name from hostname
3. POST to dashboard's `/api/companies` endpoint
4. Content script shows floating confirmation card inline (auto-dismisses after 5s)
5. Card links to company detail in dashboard for further enrichment

## Key Files

- `shared/schema.ts` - Database schema and types
- `server/db.ts` - Database connection
- `server/storage.ts` - CRUD operations (DatabaseStorage)
- `server/routes.ts` - REST API endpoints
- `client/src/App.tsx` - Root layout with sidebar
- `client/src/pages/` - All page components
- `client/src/components/` - Reusable components (sidebar, theme toggle, quick capture)

## API Endpoints

- `GET/POST /api/companies` - List/create companies
- `GET/PATCH/DELETE /api/companies/:id` - Read/update/delete company
- `GET/POST /api/companies/:id/founders` - List/add founders
- `GET/POST /api/companies/:id/notes` - List/add notes
- `DELETE /api/notes/:id` - Delete note

All API endpoints support CORS for cross-origin requests from the browser extension.
