# Square Production Mode Setup Guide

## Overview

This guide provides instructions for transitioning from Square Sandbox to Production mode for processing live payments in your LeagueVault application.

## Prerequisites

Before transitioning to production, ensure you have:

1. A Square account with activated payment processing
2. Production credentials from your Square Developer Dashboard
3. Square production application review completed (if required)

## Required Credentials

Three Square credentials must be consistent across your application:

1. **Access Token** (Server-side): `SQUARE_ACCESS_TOKEN`
   - Production format: Starts with `EAAAEv...`
   - Sandbox format: Starts with different pattern

2. **Application ID** (Client-side): `VITE_SQUARE_APP_ID` 
   - Production format: Does not contain 'sandbox-'
   - Sandbox format: Contains 'sandbox-' prefix

3. **Location ID** (Client-side): `VITE_SQUARE_LOCATION_ID`
   - Must match the appropriate location from your Square account
   - Each location has a unique ID in both sandbox and production environments

## Transition Process

Follow these steps to transition your LeagueVault application from Square Sandbox to Production:

1. **Update Environment Variables**:
   - Replace all three credentials consistently - they must all be from the same environment
   - Never mix sandbox and production credentials
   
2. **Set Environment Variables in Replit**:
   - Navigate to Secrets tab in your Replit project
   - Add/update `SQUARE_ACCESS_TOKEN` with production token
   - Add/update `VITE_SQUARE_APP_ID` with production App ID
   - Add/update `VITE_SQUARE_LOCATION_ID` with production Location ID

3. **Verify Configuration**:
   - Use the diagnostic endpoint `/api/square/config` to verify environment detection
   - Ensure all three environment values show as "PRODUCTION"

4. **Test Payments**:
   - In production, use real payment cards (no test cards)
   - Process a small test payment to verify configuration

## Important Notes

- **Security**: Production tokens provide access to process real payments - protect them accordingly
- **Testing**: In production, there are no test cards - all transactions will process real money
- **Refunds**: Real transactions can be refunded through the Square Dashboard
- **Logging**: Payment processing errors are logged for troubleshooting
- **Environment Consistency**: All three credentials must be from the same environment (sandbox or production)

## Troubleshooting

Common issues when transitioning to production:

1. **Environment Mismatch Error**: Occurs when mixing sandbox and production credentials
   - Solution: Ensure all three credentials are from the same environment

2. **Initialization Timeout**: SDK fails to load or initialize properly
   - Solution: Check browser console for errors and verify all credentials are correct

3. **Card Verification Failure**: Extra verification steps required in production
   - Solution: Ensure tokenization includes proper verification details

4. **Authorization Errors**: If you receive 401 errors from Square API
   - Solution: Verify your production token has the necessary permissions enabled

For assistance with Square integration issues, consult Square's developer documentation or contact Square developer support.