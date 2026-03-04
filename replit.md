# Dealflow Agent

A deal pipeline management dashboard for VCs. Turn any link into structured deal intelligence with AI-powered structuring and lightweight pipeline management.

## Architecture

- **Frontend:** React + TypeScript + Vite, with shadcn/ui components, TanStack Query, wouter routing
- **Backend:** Express.js API server
- **Database:** PostgreSQL with Drizzle ORM
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

## Key Files

- `shared/schema.ts` - Database schema and types
- `server/db.ts` - Database connection
- `server/storage.ts` - CRUD operations (DatabaseStorage)
- `server/routes.ts` - REST API endpoints
- `server/seed.ts` - Seed data with 6 sample companies
- `client/src/App.tsx` - Root layout with sidebar
- `client/src/pages/` - All page components
- `client/src/components/` - Reusable components (sidebar, theme toggle)

## API Endpoints

- `GET/POST /api/companies` - List/create companies
- `GET/PATCH/DELETE /api/companies/:id` - Read/update/delete company
- `GET/POST /api/companies/:id/founders` - List/add founders
- `GET/POST /api/companies/:id/notes` - List/add notes
- `DELETE /api/notes/:id` - Delete note
