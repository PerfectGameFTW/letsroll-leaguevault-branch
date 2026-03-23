import React, { useState } from 'react';
import { 
  Trophy, 
  Users, 
  TrendingUp, 
  DollarSign, 
  Home, 
  Settings, 
  CreditCard, 
  Plug, 
  LayoutDashboard, 
  ChevronRight,
  ChevronLeft,
  Search,
  Bell,
  Menu
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export function BoldSport() {
  const [sidebarExpanded, setSidebarExpanded] = useState(true);

  const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', active: true },
    { icon: Trophy, label: 'Leagues', active: false },
    { icon: Users, label: 'Bowlers', active: false },
    { icon: CreditCard, label: 'Payments', active: false },
    { icon: Plug, label: 'Integrations', active: false },
    { icon: Settings, label: 'Settings', active: false },
  ];

  const pastDueBowlers = [
    { id: 1, name: 'Mike Anderson', league: 'Tuesday Night Men', amount: '$45.00', weeks: 3 },
    { id: 2, name: 'Sarah Jenkins', league: 'Sunday Mixed Doubles', amount: '$30.00', weeks: 2 },
    { id: 3, name: 'David Thompson', league: 'Thursday Masters', amount: '$60.00', weeks: 4 },
    { id: 4, name: 'Emily Rodriguez', league: 'Tuesday Night Men', amount: '$15.00', weeks: 1 },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex font-sans text-slate-900">
      {/* Sidebar */}
      <aside 
        className={`${sidebarExpanded ? 'w-64' : 'w-20'} transition-all duration-300 ease-in-out bg-slate-900 flex flex-col relative z-20 shrink-0`}
      >
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800/50">
          {sidebarExpanded ? (
            <div className="flex items-center gap-2">
              <div className="bg-teal-500 rounded p-1.5 flex items-center justify-center">
                <Trophy className="h-5 w-5 text-white" strokeWidth={3} />
              </div>
              <span className="text-white font-black text-xl tracking-tight">LeagueVault</span>
            </div>
          ) : (
            <div className="w-full flex justify-center">
              <div className="bg-teal-500 rounded p-1.5 flex items-center justify-center">
                <Trophy className="h-5 w-5 text-white" strokeWidth={3} />
              </div>
            </div>
          )}
        </div>

        <button 
          onClick={() => setSidebarExpanded(!sidebarExpanded)}
          className="absolute -right-3 top-20 bg-slate-800 text-slate-400 hover:text-white border border-slate-700 rounded-full p-1 z-30 shadow-lg transition-colors"
        >
          {sidebarExpanded ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </button>

        <nav className="flex-1 py-6 flex flex-col gap-2 px-3">
          {navItems.map((item, index) => (
            <button
              key={index}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg transition-all duration-200 group ${
                item.active 
                  ? 'bg-slate-800 text-white' 
                  : 'text-slate-400 hover:bg-slate-800/50 hover:text-white'
              }`}
            >
              <div className={`relative flex items-center justify-center ${sidebarExpanded ? '' : 'w-full'}`}>
                {item.active && (
                  <div className="absolute -left-3 h-8 w-1 bg-teal-500 rounded-r-md" />
                )}
                <item.icon 
                  className={`h-5 w-5 ${item.active ? 'text-teal-400' : 'text-slate-400 group-hover:text-teal-400'} transition-colors`} 
                  strokeWidth={item.active ? 2.5 : 2}
                />
              </div>
              
              {sidebarExpanded && (
                <span className={`font-semibold text-sm tracking-wide ${item.active ? 'text-white' : ''}`}>
                  {item.label}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-800/50">
          <div className={`flex items-center ${sidebarExpanded ? 'gap-3' : 'justify-center'} p-2 rounded-lg bg-slate-800/50`}>
            <Avatar className="h-8 w-8 ring-2 ring-teal-500/20">
              <AvatarImage src="https://i.pravatar.cc/150?u=a042581f4e29026024d" />
              <AvatarFallback className="bg-slate-700 text-teal-400 text-xs font-bold">JD</AvatarFallback>
            </Avatar>
            {sidebarExpanded && (
              <div className="flex flex-col text-left">
                <span className="text-sm font-bold text-white leading-none">John Doe</span>
                <span className="text-xs text-slate-400 mt-1">Admin</span>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white shrink-0 flex items-center justify-between px-8 relative z-10">
          <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-gradient-to-r from-teal-500 via-teal-400 to-blue-500" />
          
          <div className="flex items-center gap-4">
            {!sidebarExpanded && (
              <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setSidebarExpanded(true)}>
                <Menu className="h-5 w-5" />
              </Button>
            )}
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Overview</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="relative hidden md:block w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search bowlers, leagues..." 
                className="w-full h-10 pl-10 pr-4 rounded-full bg-slate-100 border-transparent focus:bg-white focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 text-sm font-medium transition-all"
              />
            </div>
            <Button variant="ghost" size="icon" className="relative hover:bg-slate-100 rounded-full">
              <Bell className="h-5 w-5 text-slate-600" />
              <span className="absolute top-2 right-2 h-2 w-2 bg-rose-500 rounded-full ring-2 ring-white"></span>
            </Button>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-auto p-8">
          <div className="max-w-6xl mx-auto space-y-8">
            
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card className="border-0 shadow-sm border-l-4 border-l-teal-500 hover:shadow-md transition-shadow bg-white rounded-r-xl rounded-l-none">
                <CardContent className="p-6">
                  <div className="flex justify-between items-start">
                    <div className="space-y-3">
                      <p className="text-xs uppercase tracking-widest font-bold text-slate-500">Active Leagues</p>
                      <p className="text-4xl font-black text-slate-900 tracking-tighter">12</p>
                    </div>
                    <div className="p-3 bg-teal-50 rounded-xl">
                      <Trophy className="h-6 w-6 text-teal-600" strokeWidth={2.5} />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm border-l-4 border-l-blue-500 hover:shadow-md transition-shadow bg-white rounded-r-xl rounded-l-none">
                <CardContent className="p-6">
                  <div className="flex justify-between items-start">
                    <div className="space-y-3">
                      <p className="text-xs uppercase tracking-widest font-bold text-slate-500">Active Bowlers</p>
                      <p className="text-4xl font-black text-slate-900 tracking-tighter">148</p>
                    </div>
                    <div className="p-3 bg-blue-50 rounded-xl">
                      <Users className="h-6 w-6 text-blue-600" strokeWidth={2.5} />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm border-l-4 border-l-indigo-500 hover:shadow-md transition-shadow bg-white rounded-r-xl rounded-l-none">
                <CardContent className="p-6">
                  <div className="flex justify-between items-start">
                    <div className="space-y-3">
                      <p className="text-xs uppercase tracking-widest font-bold text-slate-500">Total Lineage Paid</p>
                      <p className="text-4xl font-black text-slate-900 tracking-tighter">$24,850</p>
                    </div>
                    <div className="p-3 bg-indigo-50 rounded-xl">
                      <TrendingUp className="h-6 w-6 text-indigo-600" strokeWidth={2.5} />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm border-l-4 border-l-violet-500 hover:shadow-md transition-shadow bg-white rounded-r-xl rounded-l-none">
                <CardContent className="p-6">
                  <div className="flex justify-between items-start">
                    <div className="space-y-3">
                      <p className="text-xs uppercase tracking-widest font-bold text-slate-500">Total Prize Fund</p>
                      <p className="text-4xl font-black text-slate-900 tracking-tighter">$18,320</p>
                    </div>
                    <div className="p-3 bg-violet-50 rounded-xl">
                      <DollarSign className="h-6 w-6 text-violet-600" strokeWidth={2.5} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Past Due Bowlers Section */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-200 flex justify-between items-center bg-white">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-2 bg-rose-500 rounded-full" />
                  <h2 className="text-lg font-black text-slate-900 tracking-tight">ACTION REQUIRED: Past Due Bowlers</h2>
                </div>
                <Button className="bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg shadow-sm">
                  View All Actions
                </Button>
              </div>
              
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-slate-50 border-b-2 border-slate-200">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs font-black uppercase tracking-wider text-slate-600 py-4 h-auto">Bowler</TableHead>
                      <TableHead className="text-xs font-black uppercase tracking-wider text-slate-600 py-4 h-auto">League</TableHead>
                      <TableHead className="text-xs font-black uppercase tracking-wider text-slate-600 py-4 h-auto">Amount Due</TableHead>
                      <TableHead className="text-xs font-black uppercase tracking-wider text-slate-600 py-4 h-auto">Status</TableHead>
                      <TableHead className="text-right text-xs font-black uppercase tracking-wider text-slate-600 py-4 h-auto">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pastDueBowlers.map((bowler) => (
                      <TableRow key={bowler.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors group">
                        <TableCell className="py-4">
                          <p className="font-bold text-slate-900">{bowler.name}</p>
                        </TableCell>
                        <TableCell className="py-4 font-medium text-slate-600">
                          {bowler.league}
                        </TableCell>
                        <TableCell className="py-4">
                          <span className="font-black text-slate-900">{bowler.amount}</span>
                        </TableCell>
                        <TableCell className="py-4">
                          <Badge variant="outline" className="bg-rose-50 text-rose-600 hover:bg-rose-50 border-rose-200 font-bold px-3 py-1 uppercase tracking-wide text-[10px]">
                            {bowler.weeks} {bowler.weeks === 1 ? 'Week' : 'Weeks'} Overdue
                          </Badge>
                        </TableCell>
                        <TableCell className="py-4 text-right">
                          <Button size="sm" variant="outline" className="font-bold border-slate-300 text-slate-700 hover:bg-teal-50 hover:text-teal-700 hover:border-teal-200 transition-colors">
                            Record Payment
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}
