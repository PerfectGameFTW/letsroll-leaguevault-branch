import { FC, ReactNode, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import type { ApiResponse, User } from '@shared/schema';

interface AdminRouteGuardProps {
  children: ReactNode;
}

export const AdminRouteGuard: FC<AdminRouteGuardProps> = ({ children }) => {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const redirectingRef = useRef(false);

  const { data: currentUserResponse, isLoading, error } = useQuery<ApiResponse<User>>({
    queryKey: ['/api/user'],
    staleTime: 1000 * 60 * 5,
  });

  const isAdmin = currentUserResponse?.data?.role === 'system_admin';

  useEffect(() => {
    if (!isLoading && !error && !isAdmin) {
      toast({
        title: 'Access Denied',
        description: 'You do not have administrator privileges.',
        variant: 'destructive',
      });
      navigate('/');
    }
  }, [isAdmin, isLoading, error, navigate, toast]);

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

  return isAdmin ? <>{children}</> : null;
};
