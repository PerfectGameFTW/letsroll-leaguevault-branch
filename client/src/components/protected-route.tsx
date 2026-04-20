import { FC, ReactNode, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import type { ApiResponse, User } from '@shared/schema';

export type RouteRequirement =
  | 'auth'
  | 'org'
  | 'orgAdmin'
  | 'systemAdmin';

interface ProtectedRouteProps {
  requirement: RouteRequirement;
  children: ReactNode;
}

const DENY_MESSAGES: Record<RouteRequirement, { title: string; description: string; redirectTo: string }> = {
  auth: {
    title: 'Authentication Required',
    description: 'Please login to access this page.',
    redirectTo: '/login',
  },
  org: {
    title: 'Access Denied',
    description: 'You need to be part of an organization to access this page.',
    redirectTo: '/',
  },
  orgAdmin: {
    title: 'Access Denied',
    description: 'You need organization administrator privileges to access this page.',
    redirectTo: '/',
  },
  systemAdmin: {
    title: 'Access Denied',
    description: 'This feature is only available to system administrators.',
    redirectTo: '/',
  },
};

function userMeetsRequirement(user: User | undefined | null, requirement: RouteRequirement): boolean {
  if (!user?.id) return false;
  switch (requirement) {
    case 'auth':
      return true;
    case 'org':
      return user.organizationId !== null;
    case 'orgAdmin':
      return user.role === 'system_admin' || user.role === 'org_admin';
    case 'systemAdmin':
      return user.role === 'system_admin';
  }
}

export const ProtectedRoute: FC<ProtectedRouteProps> = ({ requirement, children }) => {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const redirectingRef = useRef(false);

  const { data: currentUserResponse, isLoading, error } = useQuery<ApiResponse<User>>({
    queryKey: ['/api/user'],
    staleTime: 1000 * 60 * 5,
  });

  const user = currentUserResponse?.data;
  const allowed = userMeetsRequirement(user, requirement);

  useEffect(() => {
    if (!isLoading && !error && !allowed) {
      const { title, description, redirectTo } = DENY_MESSAGES[requirement];
      toast({ title, description, variant: 'destructive' });
      navigate(redirectTo);
    }
  }, [allowed, isLoading, error, requirement, navigate, toast]);

  useEffect(() => {
    if (error && !redirectingRef.current) {
      redirectingRef.current = true;
      apiRequest('/api/auth/logout', 'POST', {}).catch(() => {}).finally(() => {
        window.location.href = '/login';
      });
    }
  }, [error]);

  if (isLoading || error) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return allowed ? <>{children}</> : null;
};
