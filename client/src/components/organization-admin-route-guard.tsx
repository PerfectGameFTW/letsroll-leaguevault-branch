import { FC, ReactNode, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import type { ApiResponse, User } from '@shared/schema';

interface OrganizationAdminRouteGuardProps {
  children: ReactNode;
}

export const OrganizationAdminRouteGuard: FC<OrganizationAdminRouteGuardProps> = ({ children }) => {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // Fetch current user to check for organization admin status
  const { data: currentUserResponse, isLoading, error } = useQuery<ApiResponse<User>>({
    queryKey: ['/api/user'],
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });

  const role = currentUserResponse?.data?.role;
  const hasAdminAccess = role === 'system_admin' || role === 'org_admin';

  useEffect(() => {
    // If user data is loaded and user is not an org admin or system admin, redirect to home
    if (!isLoading && !error && !hasAdminAccess) {
      toast({
        title: 'Access Denied',
        description: 'You need organization administrator privileges to access this page.',
        variant: 'destructive',
      });
      navigate('/');
    }
  }, [hasAdminAccess, isLoading, error, navigate, toast]);

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

  // If user is authenticated and has admin access, render the children
  return hasAdminAccess ? <>{children}</> : null;
};