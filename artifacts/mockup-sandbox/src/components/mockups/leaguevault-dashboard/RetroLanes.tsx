import React, { useState } from "react";
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
  Menu,
  Bell,
  Search,
  ChevronLeft,
  CircleUserRound,
  MoreHorizontal
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

export function RetroLanes() {
  const [sidebarExpanded, setSidebarExpanded] = useState(true);

  return (
    <div className="min-h-screen bg-[#fcf9f2] text-stone-800 flex overflow-hidden font-sans">
      {/* Sidebar */}
      <aside
        className={`transition-all duration-300 ease-in-out bg-emerald-950 text-amber-50 flex flex-col relative ${
          sidebarExpanded ? "w-64" : "w-20"
        }`}
        style={{
          boxShadow: "inset -4px 0 10px rgba(0,0,0,0.3)"
        }}
      >
        <div className="p-4 flex items-center h-16 border-b border-emerald-900">
          <Trophy className={`text-orange-500 shrink-0 ${sidebarExpanded ? "mr-3" : "mx-auto"}`} size={28} />
          {sidebarExpanded && (
            <span className="font-['Playfair_Display'] text-2xl font-bold text-amber-100 tracking-wide whitespace-nowrap">
              LeagueVault
            </span>
          )}
        </div>

        <nav className="flex-1 py-6 flex flex-col gap-2 px-3">
          <NavItem icon={<LayoutDashboard />} label="Dashboard" active expanded={sidebarExpanded} />
          <NavItem icon={<Trophy />} label="Leagues" expanded={sidebarExpanded} />
          <NavItem icon={<Users />} label="Bowlers" expanded={sidebarExpanded} />
          <NavItem icon={<CreditCard />} label="Payments" expanded={sidebarExpanded} />
          <NavItem icon={<Plug />} label="Integrations" expanded={sidebarExpanded} />
          
          <div className="mt-auto">
            <NavItem icon={<Settings />} label="Settings" expanded={sidebarExpanded} />
          </div>
        </nav>

        <button 
          onClick={() => setSidebarExpanded(!sidebarExpanded)}
          className="absolute -right-3 top-20 bg-orange-600 text-amber-50 p-1 rounded-full shadow-lg border-2 border-[#fcf9f2] hover:bg-orange-500 transition-colors"
        >
          {sidebarExpanded ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </button>
        
        {/* Retro patterned footer */}
        <div className="h-12 w-full opacity-20 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCI+CjxyZWN0IHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCIgZmlsbD0ibm9uZSI+PC9yZWN0Pgo8Y2lyY2xlIGN4PSIyIiBjeT0iMiIgcj0iMiIgZmlsbD0iI2ZmZmZmZiI+PC9jaXJjbGU+Cjwvc3ZnPg==')]"></div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Header */}
        <header className="h-16 flex items-center justify-between px-8 bg-[#fdfaf5] border-b-4 border-orange-600 shadow-[0_4px_12px_rgba(0,0,0,0.05)] z-10">
          <div className="flex items-center text-stone-600">
            <span className="font-['Playfair_Display'] text-xl italic font-semibold text-emerald-900">
              Tuesday Night Classic
            </span>
            <Badge className="ml-4 bg-emerald-800 hover:bg-emerald-700 text-amber-50 border-none font-medium px-3 rounded-full">
              Active Season
            </Badge>
          </div>
          
          <div className="flex items-center gap-6">
            <button className="text-stone-500 hover:text-orange-600 transition-colors relative">
              <Bell size={22} />
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-orange-600 rounded-full border-2 border-[#fdfaf5]"></span>
            </button>
            <div className="flex items-center gap-3 pl-6 border-l border-stone-300">
              <div className="text-right hidden md:block">
                <p className="text-sm font-bold text-emerald-950 font-['Playfair_Display']">Don Carter</p>
                <p className="text-xs text-stone-500 uppercase tracking-wider">League Secretary</p>
              </div>
              <Avatar className="border-2 border-emerald-800 shadow-md">
                <AvatarFallback className="bg-orange-100 text-orange-800 font-bold font-['Playfair_Display']">DC</AvatarFallback>
              </Avatar>
            </div>
          </div>
        </header>

        {/* Scrollable Content */}
        <main className="flex-1 overflow-auto p-8 relative">
          <div className="max-w-6xl mx-auto">
            
            <div className="mb-8 border-b border-stone-300 pb-4 flex justify-between items-end">
              <div>
                <h1 className="text-4xl font-['Playfair_Display'] font-bold text-emerald-950 mb-2">
                  League Dashboard
                </h1>
                <p className="text-stone-600 text-lg">
                  Welcome back to the lanes. Here's how things are rolling.
                </p>
              </div>
              <Button className="bg-orange-600 hover:bg-orange-700 text-amber-50 rounded shadow-md border border-orange-800 font-bold px-6">
                Record Scores
              </Button>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
              <StatCard 
                title="Active Leagues" 
                value="12" 
                icon={<Trophy className="text-orange-600" size={24} />} 
              />
              <StatCard 
                title="Active Bowlers" 
                value="148" 
                icon={<Users className="text-emerald-700" size={24} />} 
              />
              <StatCard 
                title="Total Lineage Paid" 
                value="$24,850" 
                icon={<TrendingUp className="text-orange-600" size={24} />} 
              />
              <StatCard 
                title="Total Prize Fund" 
                value="$18,320" 
                icon={<DollarSign className="text-emerald-700" size={24} />} 
              />
            </div>

            {/* Past Due Bowlers */}
            <div className="bg-[#fcfcf9] rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.06)] border border-stone-200 overflow-hidden relative">
              {/* Decorative top border */}
              <div className="h-1.5 w-full bg-gradient-to-r from-emerald-800 via-emerald-600 to-emerald-800"></div>
              
              <div className="p-6 border-b border-stone-200 flex justify-between items-center bg-[#fdfaf5]">
                <h2 className="text-2xl font-['Playfair_Display'] font-bold text-emerald-950 flex items-center gap-3">
                  <span className="w-8 h-8 rounded bg-orange-100 text-orange-700 flex items-center justify-center">
                    !
                  </span>
                  Past Due Bowlers
                </h2>
                <Button variant="outline" className="border-emerald-800 text-emerald-900 hover:bg-emerald-50 bg-transparent">
                  View All Actions
                </Button>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-emerald-900 text-amber-50 font-['Playfair_Display'] uppercase tracking-wider text-sm">
                    <tr>
                      <th className="px-6 py-4 font-semibold rounded-tl-sm">Bowler</th>
                      <th className="px-6 py-4 font-semibold">League</th>
                      <th className="px-6 py-4 font-semibold">Amount Due</th>
                      <th className="px-6 py-4 font-semibold">Status</th>
                      <th className="px-6 py-4 font-semibold text-right rounded-tr-sm">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200 text-stone-700">
                    <TableRow 
                      name="Jimmy 'The Hook' Palmer" 
                      league="Tuesday Night Classic" 
                      amount="$45.00" 
                      weeks={2} 
                    />
                    <TableRow 
                      name="Sarah Jenkins" 
                      league="Weekend Rollers" 
                      amount="$22.50" 
                      weeks={1} 
                    />
                    <TableRow 
                      name="Mike Reynolds" 
                      league="Tuesday Night Classic" 
                      amount="$90.00" 
                      weeks={4} 
                      urgent
                    />
                    <TableRow 
                      name="The Pin Pals Team" 
                      league="Corporate League" 
                      amount="$120.00" 
                      weeks={2} 
                    />
                  </tbody>
                </table>
              </div>
            </div>
            
          </div>
        </main>
      </div>
    </div>
  );
}

function NavItem({ icon, label, active, expanded }: { icon: React.ReactNode, label: string, active?: boolean, expanded: boolean }) {
  return (
    <a 
      href="#" 
      className={`
        flex items-center gap-4 px-3 py-3 rounded-lg transition-all group relative overflow-hidden
        ${active 
          ? "bg-emerald-900 text-orange-400 font-bold" 
          : "text-emerald-100 hover:bg-emerald-800 hover:text-white"
        }
      `}
    >
      {active && (
        <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-orange-500 rounded-r-full" />
      )}
      <div className={`shrink-0 ${active ? "text-orange-500" : "text-emerald-300 group-hover:text-emerald-100"}`}>
        {icon}
      </div>
      {expanded && (
        <span className="whitespace-nowrap font-medium tracking-wide">
          {label}
        </span>
      )}
    </a>
  );
}

function StatCard({ title, value, icon }: { title: string, value: string, icon: React.ReactNode }) {
  return (
    <Card className="bg-[#fdfaf5] border-stone-200 border-t-4 border-t-orange-600 shadow-[0_6px_16px_rgba(0,0,0,0.06)] rounded-xl overflow-hidden relative group hover:shadow-[0_8px_24px_rgba(0,0,0,0.1)] transition-shadow">
      {/* Vintage texture overlay */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/cream-paper.png')]"></div>
      
      <CardHeader className="flex flex-row items-center justify-between pb-2 z-10 relative">
        <CardTitle className="text-sm font-bold uppercase tracking-widest text-stone-500">
          {title}
        </CardTitle>
        <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shadow-inner border border-amber-200">
          {icon}
        </div>
      </CardHeader>
      <CardContent className="z-10 relative">
        <div className="text-4xl font-['Playfair_Display'] font-bold text-emerald-950 tracking-tight">
          {value}
        </div>
        <p className="text-xs text-stone-500 mt-3 font-medium flex items-center gap-1">
          <TrendingUp size={12} className="text-emerald-600" />
          <span className="text-emerald-700 font-bold">+2.4%</span> from last season
        </p>
      </CardContent>
    </Card>
  );
}

function TableRow({ name, league, amount, weeks, urgent }: { name: string, league: string, amount: string, weeks: number, urgent?: boolean }) {
  return (
    <tr className="hover:bg-[#f8f5eb] transition-colors group">
      <td className="px-6 py-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8 border border-stone-300">
            <AvatarFallback className="bg-amber-100 text-emerald-900 font-bold text-xs font-['Playfair_Display']">
              {name.split(' ').map(n => n[0]).join('').substring(0, 2)}
            </AvatarFallback>
          </Avatar>
          <span className="font-bold text-emerald-950 font-['Playfair_Display'] text-lg">{name}</span>
        </div>
      </td>
      <td className="px-6 py-4 text-stone-600 font-medium">
        {league}
      </td>
      <td className="px-6 py-4">
        <span className="font-bold text-orange-700 font-['Playfair_Display'] text-lg">{amount}</span>
      </td>
      <td className="px-6 py-4">
        <Badge className={`${
          urgent 
            ? "bg-red-700 hover:bg-red-800 text-white" 
            : "bg-orange-600 hover:bg-orange-700 text-amber-50"
          } font-bold rounded px-2 py-1 uppercase tracking-wider text-xs border-none`}
        >
          {weeks} {weeks === 1 ? 'Week' : 'Weeks'} Late
        </Badge>
      </td>
      <td className="px-6 py-4 text-right">
        <Button variant="ghost" size="sm" className="text-emerald-800 hover:text-orange-700 hover:bg-orange-100 font-bold">
          Send Notice
        </Button>
      </td>
    </tr>
  );
}
