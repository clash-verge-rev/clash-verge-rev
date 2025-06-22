// Clerk Configuration
// To set up Clerk for your application:
// 1. Go to https://dashboard.clerk.com
// 2. Create a new application
// 3. Copy your Publishable Key from the API Keys section
// 4. Replace the CLERK_PUBLISHABLE_KEY below

export const CLERK_CONFIG = {
  // Clerk Publishable Key - configured for your application
  publishableKey: process.env.VITE_CLERK_PUBLISHABLE_KEY || "pk_test_c3VwcmVtZS1qYXZlbGluLTQ3LmNsZXJrLmFjY291bnRzLmRldiQ",
  
  // Frontend API URL configuration
  frontendApi: process.env.VITE_CLERK_FRONTEND_API || "https://supreme-javelin-47.clerk.accounts.dev",
  
  // Optional: Custom domain configuration
  // If you're using a custom domain, you can configure it here
  domain: process.env.VITE_CLERK_DOMAIN,
  
  // API version
  apiVersion: "2025-04-10" as const,
  
  // Additional options
  appearance: {
    theme: {
      primaryColor: "#1976d2", // Match your app's primary color
    },
  },
  
  // Localization
  localization: {
    locale: "en-US", // Can be changed to support different languages
  },
};

// Development/Testing configuration
export const isDevelopment = process.env.NODE_ENV === 'development';

// Validation function
export const validateClerkConfig = (): boolean => {
  const key = CLERK_CONFIG.publishableKey;
  
  // Check if key exists and has the correct format
  if (!key || key === "pk_test_REPLACE_WITH_YOUR_KEY") {
    console.error("❌ Clerk Publishable Key is not configured!");
    console.log("📋 To fix this:");
    console.log("1. Go to https://dashboard.clerk.com");
    console.log("2. Create a new application");
    console.log("3. Copy your Publishable Key");
    console.log("4. Set VITE_CLERK_PUBLISHABLE_KEY in your .env file");
    console.log("   or update CLERK_CONFIG.publishableKey in src/services/clerk-config.ts");
    return false;
  }
  
  // Check key format
  if (!key.startsWith('pk_test_') && !key.startsWith('pk_live_')) {
    console.error("❌ Invalid Clerk Publishable Key format!");
    console.log("📋 Publishable keys should start with 'pk_test_' or 'pk_live_'");
    return false;
  }
  
  return true;
}; 