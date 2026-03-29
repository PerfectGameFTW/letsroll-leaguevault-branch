import { FC, ReactNode, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import type { ApiResponse, User } from '@shared/schema';

interface OrganizationRouteGuardProps {
  children: ReactNode;
}

export const OrganizationRouteGuard: FC<OrganizationRouteGuardProps> = ({ children }) => {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // Fetch current user to check for organization membership
  const { data: currentUserResponse, isLoading, error } = useQuery<ApiResponse<User>>({
    queryKey: ['/api/user'],
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });

  const hasOrganizationAccess = currentUserResponse?.data?.organizationId !== null;

  useEffect(() => {
    // If user data is loaded and user doesn't belong to an organization, redirect to home
    if (!isLoading && !error && !hasOrganizationAccess) {
      toast({
        title: 'Access Denied',
        description: 'You need to be part of an organization to access this page.',
        variant: 'destructive',
      });
      navigate('/');
    }
  }, [hasOrganizationAccess, isLoading, error, navigate, toast]);

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

  // If user is authenticated and belongs to an organization, render the children
  return hasOrganizationAccess ? <>{children}</> : null;
};