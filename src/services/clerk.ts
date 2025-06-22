import { Clerk } from '@clerk/clerk-js';
import { CLERK_CONFIG, validateClerkConfig } from './clerk-config';

// Global Clerk instance
let clerkInstance: Clerk | null = null;

export const initializeClerk = async (retries = 3): Promise<Clerk> => {
  if (clerkInstance) {
    console.log('Clerk already initialized, returning existing instance');
    return clerkInstance;
  }

  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Attempting to initialize Clerk (attempt ${attempt}/${retries})...`);
      
      // Validate configuration before attempting to initialize
      if (!validateClerkConfig()) {
        throw new Error('Invalid Clerk configuration. Please check your Publishable Key.');
      }
      
      const publishableKey = CLERK_CONFIG.publishableKey;
      console.log('Creating new Clerk instance with key:', publishableKey.substring(0, 20) + '...');
      console.log('Using Frontend API:', CLERK_CONFIG.frontendApi);
      
      // Initialize Clerk with basic configuration
      clerkInstance = new Clerk(publishableKey);
      
      console.log('Loading Clerk instance...');
      await clerkInstance.load();
      
      console.log('Clerk instance loaded successfully');
      return clerkInstance;
    } catch (error) {
      lastError = error as Error;
      console.error(`Failed to initialize Clerk (attempt ${attempt}/${retries}):`, error);
      
      // Reset instance on error
      clerkInstance = null;
      
      // Wait before retry (except on last attempt)
      if (attempt < retries) {
        const waitTime = 1000 * attempt; // Progressive backoff
        console.log(`Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  throw lastError || new Error('Failed to initialize Clerk after all retries');
};

export const getClerk = (): Clerk | null => {
  return clerkInstance;
};

export const signIn = async (emailAddress: string, password: string) => {
  const clerk = getClerk();
  if (!clerk || !clerk.client) throw new Error('Clerk not initialized');
  
  try {
    console.log('Attempting to sign in with email:', emailAddress);
    const signInAttempt = await clerk.client.signIn.create({
      identifier: emailAddress,
      password,
    });

    console.log('Sign in attempt status:', signInAttempt.status);

    if (signInAttempt.status === 'complete') {
      await clerk.setActive({ session: signInAttempt.createdSessionId });
      console.log('Sign in completed successfully');
      return signInAttempt;
    } else {
      // Handle other statuses (needs verification, etc.)
      console.log('Sign in incomplete, status:', signInAttempt.status);
      throw new Error('Sign in incomplete');
    }
  } catch (error) {
    console.error('Sign in error:', error);
    throw error;
  }
};

export const signUp = async (emailAddress: string, password: string) => {
  const clerk = getClerk();
  if (!clerk || !clerk.client) throw new Error('Clerk not initialized');
  
  try {
    console.log('Attempting to sign up with email:', emailAddress);
    const signUpAttempt = await clerk.client.signUp.create({
      emailAddress,
      password,
    });

    console.log('Sign up attempt status:', signUpAttempt.status);

    if (signUpAttempt.status === 'complete') {
      await clerk.setActive({ session: signUpAttempt.createdSessionId });
      console.log('Sign up completed successfully');
      return signUpAttempt;
    } else {
      // Handle verification
      console.log('Sign up requires verification, status:', signUpAttempt.status);
      return signUpAttempt;
    }
  } catch (error) {
    console.error('Sign up error:', error);
    throw error;
  }
};

export const signOut = async () => {
  const clerk = getClerk();
  if (!clerk) throw new Error('Clerk not initialized');
  
  try {
    console.log('Signing out...');
    await clerk.signOut();
    console.log('Sign out completed');
  } catch (error) {
    console.error('Sign out error:', error);
    throw error;
  }
};

export const getCurrentUser = () => {
  const clerk = getClerk();
  const user = clerk?.user || null;
  console.log('Current user:', user ? 'logged in' : 'not logged in');
  return user;
};

export const isUserSignedIn = () => {
  const clerk = getClerk();
  const signedIn = !!clerk?.user;
  console.log('User signed in:', signedIn);
  return signedIn;
}; 