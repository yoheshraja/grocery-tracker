const API_BASE = 'https://grocery-tracker-backends.onrender.com';

let authToken = null;

export const authService = {
  setToken(token) {
    authToken = token;
    localStorage.setItem('authToken', token);
  },

  getToken() {
    return authToken || localStorage.getItem('authToken');
  },

  getAuthHeaders() {
    const token = this.getToken();
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  },

  async register(userData) {
    try {
      console.log('📤 Registering user:', userData.email);
      
      const response = await fetch(`${API_BASE}/register`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(userData)
      });
      
      console.log('📥 Response status:', response.status);
      
      // Check if response is JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('❌ Server returned:', text.substring(0, 100));
        throw new Error('Server error - please try again');
      }
      
      const result = await response.json();
      console.log('✅ Registration result:', result);
      
      if (!response.ok) {
        throw new Error(result.message || 'Registration failed');
      }
      
      // Save token
      if (result.token) {
        this.setToken(result.token);
      }
      
      return result;
      
    } catch (error) {
      console.error('❌ Registration error:', error);
      throw error;
    }
  },

  async login(credentials) {
    try {
      const response = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials)
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.message || 'Login failed');
      }
      
      // Save token
      if (result.token) {
        this.setToken(result.token);
      }
      
      return result;
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  },

  logout() {
    authToken = null;
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
  },

  // Request password reset (send OTP)
  async requestPasswordReset(email) {
    try {
      const response = await fetch(`${API_BASE}/auth/forgot-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Failed to send OTP');
      }
      
      return { success: true, message: data.message };
    } catch (error) {
      console.error('Request password reset error:', error);
      throw error;
    }
  },

  // Verify OTP
  async verifyOTP(email, otp) {
    try {
      const response = await fetch(`${API_BASE}/auth/verify-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, otp }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Invalid OTP');
      }
      
      return { success: true, message: data.message };
    } catch (error) {
      console.error('Verify OTP error:', error);
      throw error;
    }
  },

  // Resend OTP
  async resendOTP(email) {
    try {
      const response = await fetch(`${API_BASE}/auth/resend-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Failed to resend OTP');
      }
      
      return { success: true, message: data.message };
    } catch (error) {
      console.error('Resend OTP error:', error);
      throw error;
    }
  },

  // Reset password with OTP
  async resetPassword(email, otp, newPassword) {
    try {
      const response = await fetch(`${API_BASE}/auth/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, otp, newPassword }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Failed to reset password');
      }
      
      return { success: true, message: data.message };
    } catch (error) {
      console.error('Reset password error:', error);
      throw error;
    }
  }
};

export const productService = {
  // Fetch category list from backend
  async getCategories() {
    try {
      const response = await fetch(`${API_BASE}/categories`, {
        headers: authService.getAuthHeaders()
      });
      if (!response.ok) throw new Error('Failed');
      const data = await response.json();
      return data.categories || [];
    } catch {
      // Fallback list if endpoint not yet deployed
      return [
        'Dairy', 'Fruits', 'Vegetables', 'Meat & Seafood',
        'Bakery', 'Snacks', 'Beverages', 'Canned Goods',
        'Frozen Foods', 'Condiments', 'Personal Care', 'Other'
      ];
    }
  },

  async getProducts(filters = {}) {
    const params = new URLSearchParams();
    if (filters.category && filters.category !== 'all') params.set('category', filters.category);
    if (filters.search) params.set('search', filters.search);
    if (filters.status && filters.status !== 'all') params.set('status', filters.status);

    const url = `${API_BASE}/products${params.toString() ? '?' + params.toString() : ''}`;
    const response = await fetch(url, {
      headers: authService.getAuthHeaders()
    });
    return await response.json();
  },

  // Recently added — last 20, sorted by scanDate desc
  async getRecentProducts() {
    const response = await fetch(`${API_BASE}/products/recent`, {
      headers: authService.getAuthHeaders()
    });
    if (!response.ok) throw new Error('Failed to fetch recent products');
    return await response.json();
  },

  async addProduct(productData) {
    const response = await fetch(`${API_BASE}/products`, {
      method: 'POST',
      headers: authService.getAuthHeaders(),
      body: JSON.stringify({
        ...productData,
        expiryDate: new Date(productData.expiryDate).toISOString()
      })
    });
    return await response.json();
  },

  // Edit product (Module 4)
  async editProduct(productId, updates) {
    const response = await fetch(`${API_BASE}/products/${productId}`, {
      method: 'PUT',
      headers: authService.getAuthHeaders(),
      body: JSON.stringify({
        ...updates,
        ...(updates.expiryDate && {
          expiryDate: new Date(updates.expiryDate).toISOString()
        })
      })
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.message || 'Failed to update product');
    }
    return await response.json();
  },

  async deleteProduct(productId) {
    const response = await fetch(`${API_BASE}/products/${productId}`, {
      method: 'DELETE',
      headers: authService.getAuthHeaders()
    });
    return await response.json();
  }
};
