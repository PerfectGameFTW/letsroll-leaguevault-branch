import { FC, ReactNode, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import type { ApiResponse, User } from '@shared/schema';

interface SystemAdminRouteGuardProps {
  children: ReactNode;
}

export const SystemAdminRouteGuard: FC<SystemAdminRouteGuardProps> = ({ children }) => {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // Fetch current user to check for admin status
  const { data: currentUserResponse, isLoading, error } = useQuery<ApiResponse<User>>({
    queryKey: ['/api/user'],
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });

  const isSystemAdmin = currentUserResponse?.data?.role === 'system_admin';

  useEffect(() => {
    // If user data is loaded and user is not a system admin, redirect to home
    if (!isLoading && !error && !isSystemAdmin) {
      toast({
        title: 'Access Denied',
        description: 'This feature is only available to system administrators.',
        variant: 'destructive',
      });
      navigate('/');
    }
  }, [isSystemAdmin, isLoading, error, navigate, toast]);

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

  // If user is authenticated and is a system admin, render the children
  return isSystemAdmin ? <>{children}</> : null;
};