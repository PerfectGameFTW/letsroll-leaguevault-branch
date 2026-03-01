import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check if the script is already loaded
    const existingScript = document.querySelector(`script[src="${src}"]`);
    if (existingScript) {
      // If script is already in DOM but not fully loaded
      if (typeof window.Square !== 'undefined' && window.Square && typeof window.Square.payments === 'function') {
        resolve();
        return;
      } else {
        existingScript.remove();
      }
    }

    // Create new script element with reliability enhancements
    const script = document.createElement('script');
    script.src = src;
    script.type = 'text/javascript';
    script.async = true;
    script.crossOrigin = 'anonymous';
    
    // Attach handlers
    script.onload = () => {
      // Give a small delay to ensure script is fully initialized
      setTimeout(() => {
        // Safer window.Square check
        if (typeof window.Square !== 'undefined' && window.Square && typeof window.Square.payments === 'function') {
          resolve();
        } else {
          reject(new Error('Script loaded but Square object not properly initialized'));
        }
      }, 1000); // Increased delay for better initialization chance
    };
    
    script.onerror = (e) => {
      console.error(`[loadScript] Error loading script: ${src}`, e);
      reject(new Error(`Failed to load script: ${src}`));
    };
    
    document.head.appendChild(script);
  });
}

/**
 * Format a number as currency
 * @param amount Amount in cents
 * @returns Formatted currency string
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount / 100);
}