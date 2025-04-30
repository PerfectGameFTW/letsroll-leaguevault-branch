# Square Production Mode Integration Guide

This guide documents the changes made to the application to support Square integration in production mode. The goal was to ensure a reliable and robust integration with proper error handling and fallback mechanisms.

## Environment Detection

The system now properly detects production credentials by checking:

1. Token patterns (`EAAAEv` or `EAAAl7`) for production access tokens
2. App ID format (absence of `sandbox-` prefix indicates production)

## Server-Side Integration

Changes made in `server/services/square.ts`:

- Enhanced environment detection to recognize both `EAAAEv` and `EAAAl7` production token formats
- Improved logging for better debugging
- Set environment based on app ID format to ensure consistency between client and server
- Added detailed error handling for various Square API scenarios

A diagnostic endpoint was added in `server/routes/square.ts`:

```javascript
router.get('/config', (req, res) => {
  try {
    // Don't expose actual tokens, just show detection results
    const accessToken = process.env.SQUARE_ACCESS_TOKEN || '';
    const appId = process.env.VITE_SQUARE_APP_ID || '';
    const locationId = process.env.VITE_SQUARE_LOCATION_ID || '';
    
    // Determine environment based on token format 
    const isProductionToken = accessToken.startsWith('EAAAEv') || accessToken.startsWith('EAAAl7');
    const isProductionAppId = !appId.includes('sandbox-');
    
    sendSuccess(res, {
      environment: {
        tokenFormat: isProductionToken ? 'PRODUCTION' : 'SANDBOX',
        appIdFormat: isProductionAppId ? 'PRODUCTION' : 'SANDBOX', 
        nodeEnv: process.env.NODE_ENV || 'development'
      },
      credentials: {
        hasAccessToken: !!accessToken,
        hasAppId: !!appId,
        hasLocationId: !!locationId
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    sendError(res, 'Error checking Square environment');
  }
});
```

## Client-Side Integration

### Improvements to Square SDK Loading

Changes in `client/src/lib/utils.ts`:

- Enhanced script loading with better detection of initialization status
- Added safety checks for the global Square object
- Improved error handling and logging

### Robust Payment Processing

Changes in `client/src/lib/square.ts`:

- Added robust initialization with retry logic (up to 3 attempts)
- Improved error logging and detection
- Better timeouts for initialization (15s for production, 10s for sandbox)
- Proper cleanup of partially loaded Square SDK

### Graceful Degradation

Changes in `client/src/components/payment-form.tsx`:

- Improved payment UI with tabs for different payment methods
- Added fallback to cash/check payment if Square integration fails
- Enhanced error handling and user feedback
- Implemented a timeout detection for Square initialization with automatic fallback

## Testing Your Integration

1. Check environment detection:
   ```bash
   curl -X GET http://localhost:5001/api/square/config
   ```

2. Verify the response:
   ```json
   {
     "success": true,
     "data": {
       "environment": {
         "tokenFormat": "PRODUCTION",
         "appIdFormat": "PRODUCTION",
         "nodeEnv": "development"
       },
       "credentials": {
         "hasAccessToken": true,
         "hasAppId": true,
         "hasLocationId": true
       }
     }
   }
   ```

## Troubleshooting

If you encounter issues:

1. Check browser console for detailed error messages (filter for "[Square]" or "[loadScript]")
2. Verify your credentials are properly set in `.env`
3. Ensure your Square account is properly configured for production mode
4. Test with the payment form's alternative payment methods (cash or check) to ensure the backup works