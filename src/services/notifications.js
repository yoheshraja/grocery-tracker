import { differenceInDays } from 'date-fns';

/**
 * ONLY for UI notification (bell icon, dashboard alerts)
 * NO email / SMS sending here
 */
export const checkExpiringProducts = (products) => {
  const today = new Date();

  return products.filter(product => {
    const expiryDate = new Date(product.expiryDate);
    const daysUntilExpiry = differenceInDays(expiryDate, today);

    return daysUntilExpiry <= 7 && daysUntilExpiry >= 0;
  });
};
