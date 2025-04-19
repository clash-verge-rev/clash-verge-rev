// API base URL
const API_BASE_URL = import.meta.env.DEV ? 'http://localhost:8080' : '';

// Auth token key in localStorage
export const TOKEN_KEY = 'auth_token';

/**
 * Login with email and password
 */
export async function login(email: string, password: string) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'Login failed');
    }
    
    const data = await response.json();
    localStorage.setItem(TOKEN_KEY, data.token);
    return data;
  } catch (error: any) {
    console.error('Login error:', error);
    throw error;
  }
}

/**
 * Get current user information
 */
export async function getUserInfo() {
  const token = localStorage.getItem(TOKEN_KEY);
  
  if (!token) {
    throw new Error('Not authenticated');
  }
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/user/info`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!response.ok) {
      if (response.status === 401) {
        // Token expired or invalid
        logout();
        throw new Error('Session expired. Please login again.');
      }
      throw new Error('Failed to get user info');
    }
    
    return await response.json();
  } catch (error: any) {
    console.error('Get user info error:', error);
    throw error;
  }
}

/**
 * Logout the current user
 */
export function logout() {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Check if the user is authenticated
 */
export function isAuthenticated() {
  return !!localStorage.getItem(TOKEN_KEY);
}

/**
 * Get the authentication token
 */
export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Attach auth token to fetch requests
 */
export function fetchWithAuth(url: string, options: RequestInit = {}) {
  const token = getToken();
  
  if (!token) {
    return fetch(url, options);
  }
  
  const authOptions = {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`
    }
  };
  
  return fetch(url, authOptions);
} 