import { FC } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";
import type { ApiResponse, Bowler, BowlerGuardian } from "@shared/schema";

interface MyChild {
  link: BowlerGuardian;
  bowler: Bowler;
}

export const MyChildrenSection: FC = () => {
  const { data, isLoading } = useQuery<ApiResponse<MyChild[]>>({
    queryKey: ['/api/my-children'],
  });
  const children = data?.data ?? [];
  if (isLoading || children.length === 0) return null;
  return (
    <Card data-testid="card-my-children">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="size-4" /> My Children
        </CardTitle>
        <CardDescription>Bowlers you are a guardian for.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {children.map(({ link, bowler: child }) => (
            <li
              key={link.id}
              className="flex items-center justify-between py-2"
              data-testid={`row-my-child-${child.id}`}
            >
              <div className="flex flex-col">
                <span className="font-medium">{child.name}</span>
                <span className="text-xs text-muted-foreground capitalize">
                  {link.relationship}
                  {link.isPrimaryContact ? " · primary contact" : ""}
                  {link.isPayer ? " · payer" : ""}
                </span>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href={`/bowler/${child.id}`}>View</Link>
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};
