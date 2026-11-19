# Referral GT Labeler

A web-based annotation platform for reviewing and refining LLM-generated ground-truth labels from ophthalmology clinical records.

The platform supports collaborative human annotation, allowing multiple reviewers to validate and revise clinical information through a structured workflow.

## Key Features

- **Human-in-the-loop annotation:** Side-by-side review and editing of ophthalmic records and generated labels.
- **Collaborative labeling:** Reviewer-specific sample assignments and progress tracking.
- **Annotation management:** Autosave, sample exclusion, reviewer notes, and edit history.
- **Admin dashboard:** Reviewer management, CSV import, and annotation progress monitoring.

## Tech Stack

- **Frontend:** Next.js, TypeScript, Tailwind CSS
- **Backend & Database:** Supabase (PostgreSQL, Authentication, Row Level Security)

## Getting Started

1. Create a Supabase project and execute `supabase/schema.sql`.
2. Configure the environment variables using `.env.example`.
3. Install dependencies and start the application:

```bash
npm install
npm run dev
```

Access the application at `http://localhost:3000`.
