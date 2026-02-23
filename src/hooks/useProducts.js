import { useState, useEffect } from 'react';

export const useProducts = () => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Load products from localStorage on mount
  useEffect(() => {
    const savedProducts = localStorage.getItem('groceryProducts');
    if (savedProducts) {
      setProducts(JSON.parse(savedProducts));
    }
    setLoading(false);
  }, []);

  // Save to localStorage whenever products change
  useEffect(() => {
    localStorage.setItem('groceryProducts', JSON.stringify(products));
  }, [products]);

  const addProduct = (product) => {
    setProducts(prev => [product, ...prev]);
  };

  const removeProduct = (productId) => {
    setProducts(prev => prev.filter(p => p.id !== productId));
  };

  return {
    products,
    addProduct,
    removeProduct,
    loading
  };
};