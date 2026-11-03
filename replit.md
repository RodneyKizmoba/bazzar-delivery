# PedeAí Delivery - Food Delivery Platform

## Overview

PedeAí Delivery is a comprehensive food delivery platform built for the Angolan market. It connects customers with restaurants, manages orders, handles payments, and coordinates deliveries through a network of drivers. The platform is designed as a full-stack web application with a focus on mobile-first design and multi-language support.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript
- **Styling**: Tailwind CSS with shadcn/ui components
- **State Management**: React Context API for cart, authentication, and language
- **Routing**: Wouter for client-side navigation
- **Data Fetching**: TanStack Query for API calls and caching
- **Forms**: React Hook Form with Zod validation
- **Internationalization**: Custom translation system supporting Portuguese, English, and French

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **Authentication**: Session-based authentication with bcrypt password hashing
- **Database**: PostgreSQL with Drizzle ORM
- **Session Storage**: PostgreSQL-based session store
- **Security**: Helmet for security headers, CORS, rate limiting, and input validation
- **File Structure**: Modular architecture with separate routes, storage, and utility modules

## Key Components

### User Management
- Multi-role system supporting customers, suppliers, drivers, and admins
- Session-based authentication with secure password hashing
- User profiles with business information for suppliers
- Registration and login flows with form validation

### Restaurant & Menu System
- Restaurant profiles with categories, ratings, and delivery information
- Menu item management with pricing and descriptions
- Category-based restaurant filtering
- Featured restaurants and popular dishes sections

### Order Management
- Shopping cart functionality with item quantity management
- Order placement with address and payment method selection
- Order status tracking with real-time updates
- Order history and details

### Address System
- Multiple address management per user
- Address validation and selection during checkout
- Default address settings

### Payment Integration
- Multiple payment methods (cash, credit card, bank transfer, mobile payment)
- Payment gateway integration architecture ready for implementation
- Order confirmation and processing workflow

### Delivery System
- Driver assignment and tracking
- Real-time order status updates
- Delivery route optimization (planned)
- Integration with external driver portal (PedeAí Rider)

## Data Flow

1. **User Registration/Login**: Users register or log in through the frontend, which communicates with the backend authentication system
2. **Restaurant Browsing**: Users browse restaurants and menu items, data is cached using TanStack Query
3. **Order Placement**: Items are added to cart (local storage), then submitted as orders to the backend
4. **Order Processing**: Backend processes orders, sends notifications, and integrates with external driver portal
5. **Payment Processing**: Payment gateway integration handles transaction processing
6. **Order Tracking**: Real-time updates flow from backend to frontend for order status changes

## External Dependencies

### Database
- **PostgreSQL**: Primary database using Neon serverless PostgreSQL
- **Drizzle ORM**: Type-safe database operations with migration support

### Third-Party Services
- **Twilio**: SMS notifications for order updates (configured but optional)
- **Payment Gateway**: Ready for integration with Angolan payment providers
- **PedeAí Rider Portal**: External driver management system integration

### Development Tools
- **Vite**: Frontend build tool and development server
- **ESBuild**: Backend bundling for production
- **TypeScript**: Full-stack type safety
- **Tailwind CSS**: Utility-first CSS framework

## Deployment Strategy

### Development
- Vite development server for frontend with hot module replacement
- Express development server with tsx for TypeScript execution
- Database migrations using Drizzle Kit

### Production
- Frontend built with Vite and served as static assets
- Backend bundled with ESBuild for Node.js deployment
- Database provisioned through Neon PostgreSQL
- Environment variables for configuration (database URL, API keys, etc.)

### Configuration
- Database URL must be configured for Drizzle ORM
- Optional Twilio credentials for SMS notifications
- Payment gateway API keys (when available)
- Session secret for secure authentication

The application is designed to be scalable and maintainable, with clear separation between frontend and backend concerns, comprehensive error handling, and support for multiple languages and payment methods.