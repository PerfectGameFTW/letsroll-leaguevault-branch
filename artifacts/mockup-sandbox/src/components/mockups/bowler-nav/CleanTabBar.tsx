import React, { useState } from 'react';
import { 
  LayoutDashboard, 
  History, 
  UserCircle, 
  CreditCard, 
  TrendingUp, 
  Calendar, 
  ChevronRight, 
  ChevronDown,
  LogOut, 
  Bell, 
  ArrowLeft,
  X,
  Check
} from 'lucide-react';

const leagues = [
  { id: 1, name: 'Tuesday Night Scratch League', team: 'Pin Crushers', week: 14, totalWeeks: 30 },
  { id: 2, name: 'Friday Fun League', team: 'Strike Force', week: 8, totalWeeks: 24 },
  { id: 3, name: 'Sunday Mixed Doubles', team: 'Gutter Balls', week: 6, totalWeeks: 20 },
];

export const CleanTabBar: React.FC = () => {
  const [activeTab, setActiveTab] = useState('overview');
  const [isAdmin] = useState(true);
  const [selectedLeagueId, setSelectedLeagueId] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(false);

  const selectedLeague = leagues.find(l => l.id === selectedLeagueId)!;

  const renderContent = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <div className="space-y-6 pb-24">
            {isAdmin && (
              <button className="flex items-center text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors mb-2">
                <ArrowLeft className="w-4 h-4 mr-1" />
                Back to Admin Dashboard
              </button>
            )}

            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
              <h2 className="text-2xl font-bold text-slate-900 mb-1">Hi, Mike Johnson</h2>
              <button
                onClick={() => setSheetOpen(true)}
                className="flex items-center gap-1 text-slate-500 hover:text-slate-700 transition-colors"
              >
                <span>{selectedLeague.name}</span>
                <ChevronDown className="w-4 h-4" />
              </button>
              
              <div className="mt-4 flex flex-wrap gap-3">
                <div className="inline-flex items-center px-3 py-1.5 rounded-full bg-indigo-50 text-indigo-700 text-sm font-medium">
                  <span className="w-2 h-2 rounded-full bg-indigo-500 mr-2"></span>
                  {selectedLeague.team}
                </div>
                <div className="inline-flex items-center px-3 py-1.5 rounded-full bg-slate-100 text-slate-700 text-sm font-medium">
                  <Calendar className="w-4 h-4 mr-1.5" />
                  Week {selectedLeague.week} of {selectedLeague.totalWeeks}
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-slate-800 mb-3 px-1">Financial Overview</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 flex flex-col justify-between">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-slate-500 font-medium">Total Paid</span>
                    <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center">
                      <TrendingUp className="w-4 h-4 text-emerald-600" />
                    </div>
                  </div>
                  <div>
                    <div className="text-3xl font-bold text-slate-900">$420.00</div>
                    <div className="text-sm text-emerald-600 font-medium mt-1">Up to date</div>
                  </div>
                </div>

                <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 flex flex-col justify-between">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-slate-500 font-medium">Remaining</span>
                    <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center">
                      <CreditCard className="w-4 h-4 text-amber-600" />
                    </div>
                  </div>
                  <div>
                    <div className="text-3xl font-bold text-slate-900">$210.00</div>
                    <div className="text-sm text-slate-500 mt-1">Due by end of season</div>
                  </div>
                </div>

                <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 flex flex-col justify-between">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-slate-500 font-medium">Progress</span>
                  </div>
                  <div>
                    <div className="flex items-end justify-between mb-2">
                      <div className="text-3xl font-bold text-slate-900">66%</div>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2.5 mb-1">
                      <div className="bg-indigo-600 h-2.5 rounded-full" style={{ width: '66%' }}></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3 px-1">
                <h3 className="text-lg font-semibold text-slate-800">Recent Payments</h3>
                <button className="text-sm font-medium text-indigo-600 hover:text-indigo-700">View All</button>
              </div>
              <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                <div className="divide-y divide-slate-100">
                  {[
                    { date: 'Oct 24, 2023', amount: '$30.00', status: 'Completed', method: 'Credit Card' },
                    { date: 'Oct 17, 2023', amount: '$30.00', status: 'Completed', method: 'Cash' },
                    { date: 'Oct 10, 2023', amount: '$60.00', status: 'Completed', method: 'Credit Card' },
                  ].map((payment, i) => (
                    <div key={i} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors cursor-pointer">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                          <CreditCard className="w-5 h-5 text-slate-500" />
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900">{payment.amount}</div>
                          <div className="text-sm text-slate-500">{payment.date} &bull; {payment.method}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 text-xs font-medium">
                          {payment.status}
                        </span>
                        <ChevronRight className="w-5 h-5 text-slate-400" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      case 'history':
        return (
          <div className="flex items-center justify-center h-64 pb-24">
            <div className="text-center text-slate-500">
              <History className="w-12 h-12 mx-auto mb-3 text-slate-300" />
              <p>Payment History Page Content</p>
            </div>
          </div>
        );
      case 'profile':
        return (
          <div className="flex flex-col items-center justify-center h-64 pb-24">
            <div className="text-center text-slate-500 mb-6">
              <UserCircle className="w-12 h-12 mx-auto mb-3 text-slate-300" />
              <p>Profile Settings Page Content</p>
            </div>
            <button className="flex items-center px-4 py-2 bg-red-50 text-red-600 rounded-lg font-medium hover:bg-red-100 transition-colors">
              <LogOut className="w-4 h-4 mr-2" />
              Log Out
            </button>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-screen max-h-screen bg-[#f8fafc] overflow-hidden relative font-sans">
      <header className="flex-none bg-white border-b border-slate-200 px-4 h-16 flex items-center justify-between z-10 shadow-sm">
        <div className="w-9" />

        <div className="absolute left-1/2 transform -translate-x-1/2">
          <div className="w-9 h-9 bg-slate-900 rounded-lg flex items-center justify-center shadow-inner">
            <span className="text-white font-bold text-sm tracking-wider">PG</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button className="w-9 h-9 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 transition-colors relative">
            <Bell className="w-5 h-5" />
            <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
          </button>
          <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm border border-indigo-200 cursor-pointer">
            MJ
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto w-full">
        <div className="max-w-4xl mx-auto w-full px-4 sm:px-6 py-6">
          {renderContent()}
        </div>
      </main>

      <div className="flex-none bg-white border-t border-slate-200 pb-safe z-20 shadow-[0_-4px_12px_rgba(0,0,0,0.02)]">
        <div className="max-w-md mx-auto flex justify-between px-2 h-16">
          {(['overview', 'history', 'profile'] as const).map((tab) => {
            const icons = { overview: LayoutDashboard, history: History, profile: UserCircle };
            const labels = { overview: 'Overview', history: 'History', profile: 'Profile' };
            const Icon = icons[tab];
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 flex flex-col items-center justify-center gap-1 min-w-[70px] ${activeTab === tab ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-800'}`}
              >
                <div className={`flex items-center justify-center w-10 h-8 rounded-full transition-all duration-200 ${activeTab === tab ? 'bg-indigo-50' : 'bg-transparent'}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <span className="text-[10px] font-semibold tracking-wide">{labels[tab]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {sheetOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40 transition-opacity duration-300"
            onClick={() => setSheetOpen(false)}
          />
          <div className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up">
            <div className="bg-white rounded-t-2xl shadow-xl max-h-[70vh] overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <h3 className="text-lg font-semibold text-slate-900">Switch League</h3>
                <button
                  onClick={() => setSheetOpen(false)}
                  className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="overflow-y-auto">
                {leagues.map((league) => {
                  const isSelected = league.id === selectedLeagueId;
                  return (
                    <button
                      key={league.id}
                      onClick={() => {
                        setSelectedLeagueId(league.id);
                        setSheetOpen(false);
                      }}
                      className={`w-full text-left px-5 py-4 flex items-center justify-between transition-colors ${
                        isSelected ? 'bg-indigo-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div>
                        <div className={`font-medium ${isSelected ? 'text-indigo-700' : 'text-slate-900'}`}>
                          {league.name}
                        </div>
                        <div className="text-sm text-slate-500 mt-0.5">
                          {league.team} &bull; Week {league.week} of {league.totalWeeks}
                        </div>
                      </div>
                      {isSelected && (
                        <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0 ml-3">
                          <Check className="w-4 h-4 text-white" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="h-8" />
            </div>
          </div>
        </>
      )}

      <style>{`
        @keyframes slide-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        .animate-slide-up {
          animation: slide-up 0.3s ease-out;
        }
      `}</style>
    </div>
  );
};
