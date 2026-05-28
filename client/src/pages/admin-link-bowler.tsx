import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, Check, ExternalLink } from "lucide-react";
import { PageLoadingState } from "@/components/page-states";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { User, Bowler } from "@shared/schema";

export default function AdminLinkBowlerPage() {
  const { toast } = useToast();
  const [isLinking, setIsLinking] = useState(false);

  // Get the current user
  const { data: userResponse, isLoading: loadingUser } = useQuery<{ success: boolean; data: User }>({
    queryKey: ["/api/user"],
  });

  // Fetch bowler information
  const { data: bowlersResponse, isLoading: loadingBowlers } = useQuery<{ success: boolean; data: Bowler[] }>({
    queryKey: ["/api/bowlers"],
  });

  // Find Dudo Kroppa - bowler ID 31
  const dudoKroppa = bowlersResponse?.data?.find(b => b.id === 31);

  // Mutation for linking a bowler to the current user
  const linkBowlerMutation = useMutation({
    mutationFn: async (bowlerId: number) => {
      return apiRequest("/api/user-bowlers/link-bowler", "POST", { bowlerId });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Bowler linked to your account successfully",
        variant: "default",
      });
      // Invalidate user query to refresh the data
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      setIsLinking(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to link bowler to your account",
        variant: "destructive",
      });
      setIsLinking(false);
    },
  });

  const handleLinkBowler = () => {
    if (!dudoKroppa) {
      toast({
        title: "Error",
        description: "Dudo Kroppa not found in the system",
        variant: "destructive",
      });
      return;
    }

    setIsLinking(true);
    linkBowlerMutation.mutate(dudoKroppa.id);
  };

  if (loadingUser || loadingBowlers) {
    return (
      <Layout>
        <PageLoadingState message="Loading..." />
      </Layout>
    );
  }

  const currentUser = userResponse?.data;
  const currentlyLinkedBowler = currentUser?.bowlerId ? 
    bowlersResponse?.data?.find(b => b.id === currentUser.bowlerId) : 
    null;

  return (
    <Layout>
      <div className="container mx-auto py-8 max-w-4xl">
        <h1 className="text-3xl font-bold mb-8">Link Bowler to Admin Account</h1>

        <div className="grid gap-8">
          {/* Current User Info */}
          <Card>
            <CardHeader>
              <CardTitle>Current User Information</CardTitle>
              <CardDescription>System administrator account details</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="font-medium">User ID:</span>
                  <span>{currentUser?.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Name:</span>
                  <span>{currentUser?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Email:</span>
                  <span>{currentUser?.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Admin Status:</span>
                  <span className="flex items-center">
                    {currentUser?.role === 'system_admin' ? (
                      <>
                        <Check className="size-4 mr-1 text-green-500" />
                        System Admin
                      </>
                    ) : currentUser?.role === 'org_admin' ? (
                      <>
                        <Check className="size-4 mr-1 text-green-500" />
                        Organization Admin
                      </>
                    ) : (
                      "Regular User"
                    )}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Linked Bowler:</span>
                  <span>
                    {currentlyLinkedBowler ? (
                      <span className="font-medium text-green-600">
                        {currentlyLinkedBowler.name} (ID: {currentlyLinkedBowler.id})
                      </span>
                    ) : (
                      <span className="text-amber-600">No bowler linked</span>
                    )}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Target Bowler Info */}
          <Card>
            <CardHeader>
              <CardTitle>Target Bowler</CardTitle>
              <CardDescription>The bowler to link to your account</CardDescription>
            </CardHeader>
            <CardContent>
              {dudoKroppa ? (
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="font-medium">Bowler ID:</span>
                    <span>{dudoKroppa.id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">Name:</span>
                    <span className="font-medium text-blue-600">{dudoKroppa.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">Email:</span>
                    <span>{dudoKroppa.email}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">Status:</span>
                    <span className={dudoKroppa.active ? "text-green-600" : "text-red-600"}>
                      {dudoKroppa.active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  
                  <div className="mt-6">
                    <Button 
                      onClick={handleLinkBowler} 
                      disabled={isLinking || currentUser?.bowlerId === dudoKroppa.id}
                      className="w-full"
                    >
                      {isLinking ? (
                        <>
                          <Loader2 className="size-4 mr-2 animate-spin" />
                          Linking…
                        </>
                      ) : currentUser?.bowlerId === dudoKroppa.id ? (
                        <>
                          <Check className="size-4 mr-2" />
                          Already Linked
                        </>
                      ) : (
                        "Link Dudo Kroppa to Your Account"
                      )}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4 text-red-600">
                  Dudo Kroppa (ID: 31) not found in the system
                </div>
              )}
            </CardContent>
          </Card>

          {/* Navigation */}
          <div className="flex justify-between mt-4">
            <Button variant="outline" onClick={() => window.history.back()}>
              Back
            </Button>
            <Button 
              variant="outline" 
              onClick={() => window.location.href = "/payment-history"}
              disabled={!currentUser?.bowlerId}
            >
              Go to Payment History
              <ExternalLink className="size-4 ml-2" />
            </Button>
          </div>
        </div>
      </div>
    </Layout>
  );
}