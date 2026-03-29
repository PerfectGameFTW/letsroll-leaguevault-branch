import { FC, ReactNode, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import type { ApiResponse, User } from '@shared/schema';

interface AuthRouteGuardProps {
  children: ReactNode;
}

export const AuthRouteGuard: FC<AuthRouteGuardProps> = ({ children }) => {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // Fetch current user to check authentication status
  const { data: currentUserResponse, isLoading, error } = useQuery<ApiResponse<User>>({
    queryKey: ['/api/user'],
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });

  const isAuthenticated = !!currentUserResponse?.data?.id;

  useEffect(() => {
    // If user data is loaded and user is not authenticated, redirect to login
    if (!isLoading && !error && !isAuthenticated) {
      toast({
        title: 'Authentication Required',
        description: 'Please login to access this page.',
        variant: 'destructive',
      });
      navigate('/login');
    }
  }, [isAuthenticated, isLoading, error, navigate, toast]);

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  useEffect(() => {
    if (error) {
      apiRequest('/api/auth/logout', 'POST', {}).catch(() => {}).finally(() => {
        window.location.href = '/login';
      });
    }
  }, [error]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // If user is authenticated, render the children
  return isAuthenticated ? <>{children}</> : null;
};