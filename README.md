# FocusFlow 🚀
### Your plans should adapt to your life.

FocusFlow is an AI-powered productivity platform designed to help you plan smarter, stay focused, and recover when things don't go according to plan.

Unlike traditional to-do list applications, FocusFlow adapts to your changing schedule. When you fall behind, its **AI Schedule Recovery** feature analyzes your remaining tasks, priorities, deadlines, dependencies, and available time to suggest a realistic revised schedule.

The goal is simple: help you stay productive without feeling overwhelmed.

---

## ✨ Key Features

### 🤖 AI Schedule Recovery
- Automatically rebuilds your schedule when you fall behind.
- Considers task priorities, deadlines, dependencies, and available time.
- Takes your explanations and postponements into account.
- Validates AI-generated schedules before presenting them.
- Lets you review and approve recovery suggestions.
- Protects completed tasks from being removed.

### 🧠 AI Productivity Coach
- Get personalized productivity recommendations.
- Ask questions through an AI-powered chat interface.
- Understand your productivity patterns and execution habits.
- Receive supportive suggestions to improve your workflow.
- Get weekly productivity reports.

### 📊 Productivity Analytics
- Track completed and pending tasks.
- Monitor focus time and task completion.
- Explore productivity trends over the last 30 days.
- Identify postponements and productivity patterns.
- View analytics generated from your actual activity.

### 🎯 Task & Goal Management
- Create, update, and manage tasks.
- Organize tasks around goals and milestones.
- Set priorities and deadlines.
- Manage task dependencies.
- Track actual time spent on tasks.

### ⏱️ Focus Tracking
- Track time spent working on tasks.
- Save focus session timestamps.
- Analyze actual work duration.
- Use recorded activity to understand productivity.

### 🧪 Interactive Demo Workspace
- Explore FocusFlow with sample productivity data.
- Generate randomized sample analytics data.
- Regenerate sample datasets whenever needed.
- Keep demo data separate from your real workspace.

---

## 🛠️ Tech Stack

| Technology | Purpose |
|---|---|
| React | Frontend user interface |
| Vite | Development server and build tool |
| JavaScript | Application logic |
| Recharts | Productivity charts and analytics |
| Node.js | Backend runtime |
| Express.js | Backend API |
| OpenRouter | AI model integration |
| Gemini | Optional AI provider |
| LocalStorage | Client-side data persistence |
| Vitest | Automated testing |

---

## 🏗️ Project Structure

```text
FocusFlow/
│
├── public/
│
├── src/
│   ├── components/
│   │   ├── RecoveryWizard.jsx
│   │   ├── RecoveryHistory.jsx
│   │   ├── CoachChat.jsx
│   │   └── WeeklyReportCard.jsx
│   │
│   ├── services/
│   │   ├── recoveryService.js
│   │   ├── coachService.js
│   │   ├── analyticsService.js
│   │   └── demoService.js
│   │
│   ├── utils/
│   ├── test/
│   └── ...
│
├── server/
│   ├── index.js
│   └── coachHandler.js
│
├── .env.example
├── DEPLOYMENT.md
├── package.json
└── README.md
```

*The structure above highlights important project files; other files and components are omitted for readability.*

---

## ⚙️ Getting Started

Follow these steps to run FocusFlow locally.

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/FocusFlow.git
```

### 2. Navigate to the Project

```bash
cd FocusFlow
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment Variables

Create a `.env` file using `.env.example` as a reference.

Configure the required backend AI provider settings using your own API credentials.

**Important:** Never commit your `.env` file or expose API keys in frontend code.

### 5. Start the Application

Use the development commands configured in `package.json`.

For the frontend:

```bash
npm run dev
```

For the backend, open another terminal and use the server command configured in `package.json`.

### 6. Open FocusFlow

Visit the local URL displayed by Vite in your terminal, usually:

```text
http://localhost:5173
```

---

## 🧪 Testing

FocusFlow includes automated tests for its core functionality.

Run the test suite:

```bash
npm test
```

Create a production build:

```bash
npm run build
```

Check code quality:

```bash
npm run lint
```

---

## 🔐 Security & Reliability

- AI API credentials are handled on the backend.
- API keys should never be committed to GitHub.
- AI-generated schedules are validated before use.
- Completed tasks are protected during schedule recovery.
- Deterministic fallback logic helps maintain functionality when an AI provider is unavailable.
- Demo data is separated from real user data.

---

## 🎯 Our Core Idea

Traditional productivity tools expect users to follow a fixed plan.

**FocusFlow believes your plan should adapt to your life.**

Missing a deadline or falling behind shouldn't mean starting over. FocusFlow helps you understand what changed, reorganize your remaining work, and move forward with a realistic plan.

---

## 🚀 Future Scope

- More advanced productivity insights.
- Improved AI recommendations.
- Additional AI provider support.
- Enhanced scheduling and planning capabilities.
- Further personalization and workflow improvements.

---

<p align="center">
  <strong>FocusFlow — Your plans should adapt to your life. 💜</strong>
</p>
