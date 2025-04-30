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
        console.log(`[loadScript] Script ${src} already loaded and initialized`);
        resolve();
        return;
      } else {
        // Remove it to try loading again
        console.log(`[loadScript] Removing existing script ${src} to reload it`);
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
      console.log(`[loadScript] Script ${src} loaded successfully`);
      // Give a small delay to ensure script is fully initialized
      setTimeout(() => {
        // Safer window.Square check
        if (typeof window.Square !== 'undefined' && window.Square && typeof window.Square.payments === 'function') {
          console.log('[loadScript] Square global object successfully initialized');
          resolve();
        } else {
          console.error('[loadScript] Script loaded but Square object not properly initialized');
          // For debugging
          console.log('[loadScript] window.Square status:', {
            isDefined: typeof window.Square !== 'undefined',
            value: typeof window.Square !== 'undefined' ? 'exists' : 'undefined',
            hasPayments: typeof window.Square !== 'undefined' && window.Square ? 
              (typeof window.Square.payments === 'function' ? 'is function' : typeof window.Square.payments) : 'N/A'
          });
          reject(new Error('Script loaded but Square object not properly initialized'));
        }
      }, 1000); // Increased delay for better initialization chance
    };
    
    script.onerror = (e) => {
      console.error(`[loadScript] Error loading script: ${src}`, e);
      reject(new Error(`Failed to load script: ${src}`));
    };
    
    // Add to document
    document.head.appendChild(script);
    console.log(`[loadScript] Script ${src} appended to document head`);
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