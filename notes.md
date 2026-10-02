# Sneaker Drop — Project Notes

## Overview

This project implements a concurrency-safe limited sneaker sale system for a product with only **20 available pairs**.

The main goal is to prevent overselling when many users try to purchase the sneaker at the same time.

The system supports:

- 20-pair limited inventory
- 5-minute temporary holds
- Maximum one active hold per user
- Maximum two completed purchases per user
- FIFO waitlist when inventory is unavailable
- Automatic waitlist assignment when a hold expires
- Fake payment events
- Duplicate payment events
- Late payment events
- Out-of-order payment events
- User status page with inventory, hold countdown, and waitlist position
- PostgreSQL transactions through Prisma

---

## Tech Stack

### Backend

- Node.js
- Express.js
- TypeScript
- Prisma ORM
- PostgreSQL

### Frontend

- HTML
- CSS
- Vanilla JavaScript

### Database

PostgreSQL is used as the source of truth for:

- Products
- Users
- Holds
- Orders
- Waitlist entries
- Payment events

---

## Project Structure

```text
sneaker-drop/
│
├── frontend/
│   ├── index.html
│   ├── app.js
│   └── style.css
│
├── prisma/
│   ├── migrations/
│   ├── schema.prisma
│   └── seed.ts
│
├── src/
│   ├── controllers/
│   │   ├── buy.controller.ts
│   │   ├── payment.controller.ts
│   │   └── status.controller.ts
│   │
│   ├── routes/
│   │   ├── buy.routes.ts
│   │   ├── payment.routes.ts
│   │   └── status.routes.ts
│   │
│   ├── services/
│   │   ├── buy.service.ts
│   │   ├── inventory.service.ts
│   │   ├── payment.service.ts
│   │   └── status.service.ts
│   │
│   ├── prisma.ts
│   ├── app.ts
│   └── server.ts
│
├── docker-compose.yml
├── package.json
├── prisma.config.ts
├── tsconfig.json
└── NOTES.md
```

---

# Requirements

Before running the project, install:

- Node.js 20+
- npm
- PostgreSQL 14+
- Git

Docker can also be used for PostgreSQL if preferred.

---

# Environment Variables

Create a `.env` file in the project root.

Example:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/sneaker_drop"
```

Do not commit `.env` to the repository.

An `.env.example` file can be used for sharing the required environment variable format without exposing credentials.

---

# Installation

Clone the repository:

```bash
git clone https://github.com/RituChoudhary01/sneakdrop-assignment.git
cd sneakdrop-assignment
```

Install dependencies:

```bash
npm install
```

---

# Database Setup

## Option 1 — Local PostgreSQL

Create a PostgreSQL database named:

```text
sneaker_drop
```

Then configure the connection in `.env`.

Run Prisma migrations:

```bash
npx prisma migrate dev
```

Seed the database:

```bash
npx prisma db seed
```

---

## Option 2 — Docker PostgreSQL

If using the provided Docker configuration:

```bash
docker compose up -d
```

Then run:

```bash
npx prisma migrate dev
npx prisma db seed
```

---

# Run the Backend

Start the development server:

```bash
npm run dev
```

The API runs on:

```text
http://localhost:3000
```

---

# Frontend

The frontend is located inside:

```text
frontend/
```

Open:

```text
frontend/index.html
```

in a browser, or serve the frontend using a local static server.

The frontend communicates with the backend API running on port `3000`.

---

# Core Business Rules

## 1. Limited Inventory

The product has only:

```text
20 pairs
```

The system must never allocate more than the available inventory.

Inventory availability is calculated using completed purchases and active holds.

Conceptually:

```text
Available Pairs =
Total Stock
- Completed Purchases
- Active Holds
```

Expired holds are no longer counted as active inventory reservations.

---

## 2. Five-Minute Hold

When a user successfully gets a pair:

```text
ACTIVE HOLD
```

is created with an expiry time five minutes in the future.

The user can complete payment during this period.

If payment is not completed before expiry, the hold becomes:

```text
EXPIRED
```

and the inventory becomes available again.

---

## 3. One Active Hold Per User

A user cannot hold multiple pairs simultaneously.

If a user already has an active hold, another Buy request does not create another hold.

The existing hold is returned instead.

---

## 4. Maximum Two Purchases

A user can purchase a maximum of two pairs in total.

Completed purchases are counted using successful/paid orders.

Once the user reaches two completed purchases, further purchases are rejected.

---

# Waitlist

When no inventory is available, users can join a FIFO waiting line.

Waitlist entries are ordered by:

```text
createdAt
```

and then by:

```text
id
```

This provides deterministic FIFO ordering.

Example:

```text
User 21 → Position #1
User 22 → Position #2
User 23 → Position #3
```

When a hold expires, the first eligible waiting user receives the newly available pair.

A new five-minute hold is created for that user.

---

# Payment System

There is no real payment provider in this assignment.

The application exposes a fake payment endpoint that accepts payment events.

Supported events include:

```text
PENDING
SUCCEEDED
FAILED
```

Each payment event contains an event ID so duplicate events can be detected.

---

## Duplicate Payment Events

Payment providers may send the same event more than once.

The database stores a unique:

```text
eventId
```

for every payment event.

If the same event is received again, it is treated as a duplicate instead of applying the payment operation twice.

---

# Late Payments

A payment can arrive after the original event or hold has changed state.

The payment service checks the current order and hold state before applying the event.

A payment that arrives too late to safely fulfil the order can be marked as requiring a refund rather than allocating inventory incorrectly.

---

# Out-of-Order Payment Events

Payment events can arrive in an unexpected order.

For example:

```text
SUCCEEDED
FAILED
```

or:

```text
FAILED
SUCCEEDED
```

The payment service evaluates the existing order state and event information before applying a state transition.

This prevents an old/stale event from blindly overwriting a newer state.

---

# Concurrency Protection

The most important part of this project is preventing overselling.

Thousands of users can send Buy requests at approximately the same time.

The inventory allocation flow therefore uses database transactions and row-level database consistency instead of relying only on frontend checks.

The product/inventory state is treated as shared state and is protected at the database level.

The important principle is:

```text
Check inventory
      ↓
Reserve inventory
      ↓
Create hold/order
      ↓
Commit transaction
```

These operations need to happen atomically so concurrent requests cannot both allocate the same final pair.

Frontend checks are not considered sufficient for inventory protection because multiple requests can bypass frontend state simultaneously.

---

# Database Models

## Product

Stores the sneaker and its inventory.

Important fields include:

```text
totalStock
priceCents
saleOpensAt
```

---

## User

Represents a customer participating in the sale.

---

## Hold

Represents a temporary reservation.

Important states:

```text
ACTIVE
COMPLETED
EXPIRED
RELEASED
```

A hold contains an expiry timestamp.

---

## Order

Represents the purchase associated with a hold.

Important states:

```text
PENDING
PAID
FAILED
REFUNDED
```

---

## WaitlistEntry

Represents a user's position in the waiting line.

Important states:

```text
WAITING
ASSIGNED
CANCELLED
SKIPPED
```

---

## PaymentEvent

Stores incoming fake payment events.

Important information includes:

```text
eventId
orderId
type
providerCreatedAt
outcome
receivedAt
```

The unique event ID provides idempotency for duplicate payment messages.

---

# API Endpoints

## Buy

```http
POST /api/buy
```

Example request:

```json
{
  "userId": 21
}
```

Possible outcomes include:

```text
HOLD_CREATED
ALREADY_HELD
WAITLISTED
ALREADY_WAITING
```

---

## Payment

```http
POST /api/payment
```

Example:

```json
{
  "eventId": "unique-event-id",
  "orderId": 1,
  "type": "SUCCEEDED",
  "providerCreatedAt": "2026-10-02T10:00:00.000Z"
}
```

Supported payment event types:

```text
PENDING
SUCCEEDED
FAILED
```

---

## User Status

```http
GET /api/status/:userId
```

The status response contains information such as:

- pairs remaining
- number of completed purchases
- active hold
- hold expiry time
- pending order ID
- waitlist position

The frontend uses this endpoint to update the UI.

---

# Frontend

The frontend provides a simple interface for demonstrating the system.

It shows:

- Current user
- Pairs remaining
- Purchased count
- Current hold
- Hold countdown
- Waitlist position
- Payment actions

The payment UI provides:

```text
Payment Success
Payment Failed
Payment Pending
```

This makes it possible to demonstrate the fake payment provider behavior without integrating a real payment gateway.

---

# Important Edge Cases

The implementation is designed around the following scenarios:

### User buys while inventory is available

```text
Buy
 ↓
Create 5-minute hold
 ↓
Create pending order
```

### User pays successfully

```text
Payment SUCCEEDED
 ↓
Order becomes PAID
 ↓
Hold becomes COMPLETED
```

### User payment fails

```text
Payment FAILED
 ↓
Order becomes FAILED
 ↓
Hold is released
 ↓
Inventory becomes available
```

### User does not pay

```text
5 minutes pass
 ↓
Hold expires
 ↓
Inventory becomes available
 ↓
Next eligible waitlisted user can receive the pair
```

### Inventory is exhausted

```text
No available pair
 ↓
Create FIFO waitlist entry
```

### Duplicate payment

```text
Same eventId received again
 ↓
Duplicate detected
 ↓
Event is ignored
```

### Late payment

```text
Payment arrives after hold/order state changed
 ↓
Current state is checked
 ↓
Payment is either safely applied or marked for refund/ignored
```

---

# Demo Flow

For the screen recording, the following flow can be demonstrated:

1. Start the PostgreSQL database.
2. Start the backend.
3. Open the frontend.
4. Select a user.
5. Click **Buy Now**.
6. Show the five-minute countdown.
7. Show the pending payment state.
8. Send a successful payment event.
9. Show the purchased count increasing.
10. Demonstrate a failed payment.
11. Demonstrate pending payment.
12. Demonstrate duplicate/late payment behavior.
13. Demonstrate sold-out inventory and waitlist behavior.
14. Show that expired inventory can be assigned to the next waitlisted user.

---

# Design Decisions

## PostgreSQL as the Source of Truth

Inventory and order state are stored in PostgreSQL instead of relying on in-memory variables.

This allows multiple application requests/processes to operate against the same persistent state.

## Transactions

Critical inventory operations are performed inside database transactions to protect shared inventory state from concurrent requests.

## Database-backed Idempotency

Payment events use unique event IDs.

This makes duplicate provider messages safe to process.

## FIFO Waitlist

Waitlist entries are ordered by creation time and ID to provide deterministic ordering.

## Server-side Validation

Business rules such as purchase limits, active holds, payment state, and inventory availability are validated on the backend.

The frontend is only a presentation layer and is not trusted for inventory decisions.

---

# Assumptions

- The assignment contains one limited sneaker product.
- Initial stock is 20 pairs.
- Payment processing is simulated.
- Authentication is outside the scope of the assignment; users are selected using user IDs for demonstration.
- The frontend is intentionally simple because the assignment prioritizes correctness and concurrency behavior over UI design.

---

# Security / Repository Notes

The following files/directories should not be committed:

```text
.env
node_modules/
dist/
.cursor/
.claude/
.devin/
.agents/
```

Environment-specific secrets should remain in `.env`.

---

# Submission

Repository:

```text
https://github.com/RituChoudhary01/sneakdrop-assignment
```

The submission should include:

- Source code
- Prisma schema and migrations
- Frontend
- `NOTES.md`
- Git history/repository
- Screen recording explaining the implementation and demonstrating the main flows