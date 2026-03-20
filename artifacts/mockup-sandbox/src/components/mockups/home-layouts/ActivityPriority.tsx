import React from 'react';
import './_group.css';
import { 
  Trophy, 
  Users, 
  TrendingUp, 
  DollarSign, 
  AlertCircle, 
  ChevronRight,
  Bell,
  Search,
  Menu,
  MoreHorizontal
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const ActivityPriority = () => {
  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col font-sans">
      {/* Topbar Navigation */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-white px-6 shadow-sm">
        <div className="flex items-center gap-2 font-semibold text-primary">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Trophy className="h-5 w-5" />
          </div>
          <span className="text-lg tracking-tight">LeagueVault</span>
        </div>
        
        <div className="ml-auto flex items-center gap-4">
          <div className="relative hidden sm:block">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search bowlers, leagues..."
              className="w-64 rounded-full bg-muted/50 pl-8 focus-visible:bg-white"
            />
          </div>
          <Button variant="ghost" size="icon" className="relative text-muted-foreground">
            <Bell className="h-5 w-5" />
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-destructive"></span>
          </Button>
          <Avatar className="h-8 w-8 border">
            <AvatarImage src="https://i.pravatar.cc/150?u=admin" />
            <AvatarFallback>AD</AvatarFallback>
          </Avatar>
        </div>
      </header>

      {/* Slim Stats Banner - Background Context */}
      <div className="border-b bg-white/50 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-2">
          <div className="flex w-full items-center justify-between text-xs sm:text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <Trophy className="h-4 w-4 text-primary" />
                5
              </span>
              <span className="hidden sm:inline">Total Leagues</span>
              <span className="inline sm:hidden">Leagues</span>
            </div>
            
            <div className="h-4 w-[1px] bg-border hidden sm:block"></div>
            
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <Users className="h-4 w-4 text-blue-500" />
                42
              </span>
              <span className="hidden sm:inline">Active Bowlers</span>
              <span className="inline sm:hidden">Bowlers</span>
            </div>
            
            <div className="h-4 w-[1px] bg-border hidden sm:block"></div>
            
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <TrendingUp className="h-4 w-4 text-green-500" />
                $12,450
              </span>
              <span className="hidden sm:inline">Lineage Paid</span>
              <span className="inline sm:hidden">Lineage</span>
            </div>
            
            <div className="h-4 w-[1px] bg-border hidden sm:block"></div>
            
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <DollarSign className="h-4 w-4 text-amber-500" />
                $6,225
              </span>
              <span className="hidden sm:inline">Prize Fund</span>
              <span className="inline sm:hidden">Prizes</span>
            </div>
          </div>
        </div>
      </div>

      <main className="flex-1 p-6">
        <div className="mx-auto max-w-6xl space-y-8">
          
          {/* Page Header */}
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
            <p className="text-sm text-muted-foreground">Manage your leagues and keep track of payments.</p>
          </div>

          {/* PRIMARY CONTENT: Requires Attention (Past Due) */}
          <section>
            <Card className="border-orange-200 shadow-md shadow-orange-100/50 overflow-hidden">
              <div className="h-1.5 w-full bg-gradient-to-r from-orange-500 to-amber-400"></div>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2 text-xl text-orange-950">
                    <AlertCircle className="h-5 w-5 text-orange-500" />
                    Requires Attention
                  </CardTitle>
                  <CardDescription className="text-orange-900/60">
                    5 bowlers have past due payments requiring immediate action.
                  </CardDescription>
                </div>
                <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 font-semibold px-3 py-1 text-sm">
                  Total Owed: $450.00
                </Badge>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="rounded-md border border-orange-100 bg-white">
                  <Table>
                    <TableHeader className="bg-orange-50/50">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-[250px] text-orange-900/70">Bowler</TableHead>
                        <TableHead className="text-orange-900/70">League</TableHead>
                        <TableHead className="text-orange-900/70">Status</TableHead>
                        <TableHead className="text-right text-orange-900/70">Amount Due</TableHead>
                        <TableHead className="w-[50px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[
                        { name: "Michael Chang", email: "m.chang@example.com", league: "Tuesday Night Mixed", weeks: 3, amount: "$135.00", avatar: "MC" },
                        { name: "Sarah Jenkins", email: "sarah.j@example.com", league: "Thursday Trios", weeks: 2, amount: "$90.00", avatar: "SJ" },
                        { name: "David Miller", email: "dmiller88@example.com", league: "Tuesday Night Mixed", weeks: 2, amount: "$90.00", avatar: "DM" },
                        { name: "Amanda Peterson", email: "amanda.p@example.com", league: "Sunday Morning Doubles", weeks: 1, amount: "$45.00", avatar: "AP" },
                        { name: "Robert Wilson", email: "rwilson@example.com", league: "Thursday Trios", weeks: 2, amount: "$90.00", avatar: "RW" }
                      ].map((bowler, i) => (
                        <TableRow key={i} className="hover:bg-orange-50/30">
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <Avatar className="h-9 w-9 border border-orange-100 bg-orange-50">
                                <AvatarFallback className="text-orange-700 font-medium">{bowler.avatar}</AvatarFallback>
                              </Avatar>
                              <div>
                                <div className="font-medium text-foreground">{bowler.name}</div>
                                <div className="text-xs text-muted-foreground">{bowler.email}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm font-medium text-muted-foreground">{bowler.league}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="bg-orange-100/80 text-orange-700 hover:bg-orange-100/80 rounded-sm">
                              {bowler.weeks} week{bowler.weeks > 1 ? 's' : ''} behind
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-bold text-orange-600">{bowler.amount}</TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
              <CardFooter className="bg-orange-50/30 border-t border-orange-100 px-6 py-3">
                <Button variant="ghost" className="w-full text-orange-700 hover:text-orange-800 hover:bg-orange-100/50 gap-1 text-sm font-medium">
                  Send Reminders to All
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </CardFooter>
            </Card>
          </section>

          {/* SECONDARY CONTENT: Payment Overview */}
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 pl-1">Payment Overview</h2>
            <Card>
              <CardContent className="p-6">
                <div className="flex flex-col gap-6">
                  {/* Distribution Bar */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-end">
                      <div>
                        <div className="text-3xl font-bold tracking-tight text-foreground">$18,675</div>
                        <div className="text-sm font-medium text-muted-foreground">Total Expected Revenue</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium text-green-600">66.7% Collected</div>
                      </div>
                    </div>
                    
                    {/* Visual Bar Component */}
                    <div className="h-4 w-full flex rounded-full overflow-hidden bg-muted">
                      <div className="bg-green-500 h-full" style={{ width: '66.7%' }} title="Paid"></div>
                      <div className="bg-blue-400 h-full" style={{ width: '30.9%' }} title="Pending"></div>
                      <div className="bg-orange-500 h-full" style={{ width: '2.4%' }} title="Overdue"></div>
                    </div>
                  </div>

                  {/* Legend/Details */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <div className="h-3 w-3 rounded-sm bg-green-500"></div>
                        Paid
                      </div>
                      <div className="text-2xl font-semibold">$12,450</div>
                      <div className="text-xs text-muted-foreground">Cleared & deposited</div>
                    </div>
                    
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <div className="h-3 w-3 rounded-sm bg-blue-400"></div>
                        Pending
                      </div>
                      <div className="text-2xl font-semibold">$5,775</div>
                      <div className="text-xs text-muted-foreground">Processing via Square</div>
                    </div>
                    
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <div className="h-3 w-3 rounded-sm bg-orange-500"></div>
                        Overdue
                      </div>
                      <div className="text-2xl font-semibold text-orange-600">$450</div>
                      <div className="text-xs text-muted-foreground">Requires attention</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

        </div>
      </main>
    </div>
  );
};

export default ActivityPriority;