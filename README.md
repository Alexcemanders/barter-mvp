# BarterGrid — Zero-Friction Community Agricultural Bartering Platform

An investor-ready, full-stack MVP engineered to systematically eliminate agricultural waste, combat corporate supply chain dominance, and foster local food security through an automated, cash-free barter ecosystem.



---

## 💡 What Is BarterGrid?

Growing up in a farming family, you quickly learn the grueling physical labor and risk that goes into every single harvest. Watching perfectly good crops go to waste at the end of a market day is a massive economic and environmental tragedy. Surprisingly, the main barrier preventing local vendors from trading their extra crops isn't a lack of interest—it is the psychological friction of initiating a face-to-face trade and the mathematical uncertainty of calculating a fair exchange rate on the spot.

**BarterGrid is the digital equivalent of a roadside "Firewood Available" sign.** By establishing explicit consent through a public declaration system, it entirely removes the social awkwardness of bartering. Anchored in a pilot study optimized for the **Hall County Farmers Market**, BarterGrid streamlines the entire trade lifecycle for registered local growers.

### The Structural Layers
| Layer | What It Does |
| :--- | :--- |
| **Onboarding & Authentication** | Frictionless entry using verified Vendor IDs and names, automatically spinning up profiles to avoid setup barriers on chaotic market days. |
| **Profile & Listing System** | A "declaration-first" hub where farmers select their active crop offerings, target wants, and set their active vending coordinates. |
| **Proximity Matching Feed** | A localized discovery feed that automatically pairs viable trades based on exact complementary offer/want vectors and geographic proximity. |
| **Valuation & Scaling Engine** | An automated calculator that pulls live regional commodity data via the Bureau of Labor Statistics (BLS) Public API and scales it with custom labor-intensity constants to enforce fair, non-negotiable exchange ratios. |
| **Spatial Meetup Engine** | Computes the precise geographic midpoint between paired vendors and queries the Nominatim OpenStreetMap API to generate a list of safe, public meetup locations. |
| **State Machine Inbox** | Manages proposal delivery states, recognition notes, and scheduling details through a clean, multi-step receiver verification flow. |
| **Interactive Map Finalization** | Guides both users to a shared map view with quick-action routing buttons, securely recording the transaction only after a dual-party handshake completion. |

---

## 🛠️ Feature Highlights

* **The 60-Second Rule UI:** Ruthlessly optimized mobile views designed for busy farmers with muddy hands, ensuring any primary action can be completed in under a minute.
* **Smart Automated Scaling:** Completely removes the pressure of calculation—if a user wants 1 lb of tomatoes, the engine automatically calculates and requires the exact fair volume of potatoes or honey in return.
* **Proximity-Based Discovery:** Filters out distant offers to keep agricultural assets circulating within hyper-local micro-economies, reducing food miles and carbon footprints.
* **Dual-Handshake Security:** Protects users from lopsided or unfulfilled trades by locking transaction states into a strict relational database lifecycle.

---

## 🏗️ Technical Architecture & Directory Structure

BarterGrid is architected to be highly performant, lightweight, and responsive. The application synchronizes a cross-platform mobile frontend framework built with React Native and Expo with a fast, asynchronous Python backend and a structured MySQL relational schema.

```text
barter-mvp/
├── backend/                     # Python Backend Service
│   ├── main.py                  # Core application logic, BLS/Nominatim API handling, and API endpoints
│   └── requirements.txt         # Python dependency management
├── src/                         # React Native (TypeScript) Frontend Source
│   ├── api/                     # Asynchronous native fetch handlers linking to the backend
│   ├── data/                    # Local static constants and mock configurations
│   ├── hooks/                   # Custom reusable React hooks
│   ├── models/                  # TypeScript interfaces and structural models
│   ├── navigation/              # Stack and tab navigation configuration
│   ├── screens/                 # Dashboard, Profile, Discovery Feed, Inbox, and Map Views
│   ├── storage/                 # Local persistence layer utilities
│   ├── types/                   # App-wide global TypeScript types
│   ├── utils/                   # Helper functions, math utilities, and formatters
│   └── theme.ts                 # Global style tokens, colors, and layout themes
├── App.js                       # Main cross-platform mobile entry point
├── app.json                     # Expo configuration settings
├── index.js                     # Root entry registration
├── package.json                 # Node package dependency bundles
└── tsconfig.json                # TypeScript project configuration parameters
```
---

## 📊 Valuation Engine & Mathematical Scaling

To eliminate negotiation friction and protect farmers from lopsided trades, BarterGrid automates fair exchange values using live financial data.

The system pulls real-time consumer commodity indexes via the **Bureau of Labor Statistics (BLS) Public API** to get baseline retail values, then modifies them using a custom labor-intensity matrix:

$$\text{Artisan Value} = \text{Retail Price (BLS)} \times \text{Labor Constant } (\gamma)$$

Where $\gamma$ represents the historical physical overhead and crop risk associated with producing that specific agricultural asset.

### The Scaling Loop
When Farmer $A$ proposes a trade to Farmer $B$, the backend calculates the strict volume equilibrium using the absolute ratio of their calculated artisan values:

$$\text{Exchange Ratio} = \frac{\text{Artisan Value}_{\text{Crop A}}}{\text{Artisan Value}_{\text{Crop B}}}$$

The system enforces this ratio as a non-negotiable constant during proposal creation. This completely punches out the need for haggling on the sales floor.

---

## 🚀 Step-by-Step Installation & Run Guide

### System Prerequisites
* **Python:** Version 3.10 or higher
* **Node.js:** Version 18 or higher (with Expo CLI)
* **Database:** MySQL Server instance

### 1. Launch the Python Backend Service
```bash
# Navigate into the backend root directory
cd barter-mvp/backend
```
## Install all required Python dependencies
pip install -r requirements.txt

## Start the local development server
uvicorn main:app --reload --port 8000
API Gateway Live at: http://localhost:8000

2. Launch the React Native (Expo) Frontend
Bash
## Navigate back to the main frontend directory root
cd ..

## Install local Node modules
npm install

## Start the Expo application bundler
npx expo start
Press a for Android Emulator, i for iOS Simulator, or scan the QR code on your phone via the Expo Go app!

# 🗺️ Operational Roadmap & Scalability Plan
Stage 2 Launch (June 20–26, 2026): Initiating a closed, targeted 10-vendor soft-launch pilot program at the Hall County Farmers Market to isolate matching edge cases and monitor server load under live field conditions.

Educational Integration (July 2026): Coordinating a comprehensive vendor onboarding and digital literacy seminar in direct partnership with the UGA Extension office.

Regional Expansion (Target September 2026): Pushing scaling loops to track over 100 active verified growers across North Georgia, systematically protecting independent family farms through localized resource loops.
