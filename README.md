# Restaurant Shift Scheduler

A full-stack restaurant scheduling application designed to simplify employee scheduling, staff management, and communication between restaurant managers and employees.

The application supports multiple restaurants, allowing each business to manage its own employees, schedules, and account approvals independently.

## Features

### Employee Scheduling
- Create and manage restaurant work schedules.
- Organize shifts by employee and position.
- Allow employees to access their scheduling information.
- Support restaurant-specific scheduling.

### Staff Management
- Manage employee accounts and information.
- Assign employee positions.
- Track employee qualifications, including liquor card information.
- Manage employee access to the application.

### Account Registration and Approval
- Employees and Managers can create accounts.
- Users select their restaurant during registration.
- New accounts remain inactive until approved.
- Restaurant Managers approve account requests for their restaurant.

### Multi-Restaurant Support
- Support multiple restaurants within one application.
- Each restaurant maintains its own staff and scheduling information.
- Restaurant Managers manage their own restaurant independently.
- Restaurant selection is available during registration.

### Application Administration
- A separate App Administrator role manages restaurant creation.
- Only the App Administrator can add restaurants.
- The App Administrator approves the first Manager for a new restaurant.
- Once approved, Managers handle their restaurant's staff and account requests.

## User Roles

| Role | Permissions |
|------|-------------|
| App Administrator | Create restaurants and approve their first Manager |
| Restaurant Owner | Manage their restaurant's staff and scheduling |
| Restaurant Manager | Manage staff, schedules, and account approvals |
| Employee | Access employee scheduling features |

The App Administrator role is separate from restaurant-level permissions.

## Tech Stack

| Technology | Purpose |
|------------|---------|
| Next.js | Full-stack web framework |
| React | User interface |
| TypeScript | Application development |
| Tailwind CSS | Styling |
| PostgreSQL | Relational database |
| Neon | Cloud PostgreSQL hosting |
| Auth.js | Authentication |
| Zod | Input validation |
| Vercel | Application deployment |
| GitHub | Version control |

## How It Works

### 1. Restaurant Setup

The App Administrator creates a restaurant through the Restaurant Management dashboard.

The restaurant becomes available in the registration dropdown.

### 2. Manager Registration

The restaurant's first Manager registers for an account.

The App Administrator reviews and approves the request.

Once approved, the Manager can access the restaurant's management features.

### 3. Employee Registration

Employees register and select their restaurant.

Their accounts remain inactive until approved by restaurant management.

### 4. Scheduling and Staff Management

Managers organize schedules, manage employees, and oversee their restaurant's operations.

Employees access their scheduling information through their accounts.

## Getting Started

### Prerequisites

- Node.js
- npm
- PostgreSQL database (Neon recommended)

### Installation

Clone the repository:

```bash
git clone https://github.com/ryangrankin/shift-scheduler.git
```

Navigate to the project:

```bash
cd shift-scheduler
```

Install dependencies:

```bash
npm install
```

### Environment Variables

Create a `.env.local` file in the project root.

Configure the database connection and authentication environment variables required by the application.

Do not commit `.env.local` or any credentials to GitHub.

### Run Locally

Start the development server:

```bash
npm run dev
```

Open `http://localhost:3000` in your browser.

### Production Build

To verify the application builds successfully:

```bash
npm run build
```

## Project Structure

```text
app/
├── admin/
│   └── restaurants/        # App Administrator dashboard
├── api/
│   ├── admin/              # Restaurant administration APIs
│   ├── manager/            # Restaurant management APIs
│   ├── register/           # Account registration
│   └── restaurants/        # Public restaurant listing
├── manager/                # Manager dashboard and tools
└── register/               # Account registration page
```

## Security and Access Control

The application uses role-based permissions to restrict access to management features.

- Accounts must be approved before accessing the application.
- Restaurant Managers can only approve accounts associated with their restaurant.
- Restaurant creation requires App Administrator privileges.
- Administrative API endpoints verify permissions against the database.
- Authentication is managed through Auth.js.

## Project Status

**Status: Active Development**

Current development focuses on supporting multiple restaurants, simplifying staff management, and improving the scheduling experience.

### Potential Future Improvements

- Email notifications for account approvals and schedule changes.
- Employee shift swap requests.
- Schedule conflict detection.
- Expanded restaurant administration tools.
- Mobile experience improvements.

## Author

Developed by Ryan Rankin.

B.S. Information & Computer Sciences and B.A. American Studies  
University of Hawaiʻi at Mānoa

## License

No open-source license has been specified.
