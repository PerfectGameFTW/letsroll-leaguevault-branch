import { useQuery } from '@tanstack/react-query';
import { Layout } from '@/components/layout';
import { AdminRouteGuard } from '@/components/admin-route-guard';
import { OrganizationUsersOnly } from '@/components/organization-users-only';
import { UserManagement } from '@/components/admin/user-management';
import { OrganizationUserManagement } from '@/components/admin/organization-user-management';

interface User {
  id: number;
  email: string;
  name: string | null;
  isAdmin: boolean;
  isOrganizationAdmin: boolean;
  organizationId: number | null;
  bowlerId: number | null;
  createdAt: string;
}

export default function AdminPage() {
  const { data: userResponse } = useQuery<{ success: boolean; data: User }>({
    queryKey: ['/api/user'],
  });
  
  const currentUser = userResponse?.data;
  
  return (
    <Layout>
      <AdminRouteGuard>
        <div className="container py-6">
          <div className="mb-6">
            <h1 className="text-4xl font-bold">Admin</h1>
          </div>
          
          <div className="mt-6">
            {currentUser?.isAdmin && currentUser?.organizationId ? (
              <OrganizationUserManagement />
            ) : (
              <OrganizationUsersOnly />
            )}
          </div>
        </div>
      </AdminRouteGuard>
    </Layout>
  );
}
