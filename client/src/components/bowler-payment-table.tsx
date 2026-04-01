import { FC } from "react";
import { CreditCard, Banknote, FileText, ChevronRight, Receipt } from "lucide-react";
import { differenceInWeeks, format } from "date-fns";
import { formatCurrency } from "@/lib/utils";
import type { Payment, League } from "@shared/schema";

interface BowlerPaymentTableProps {
  payments: Payment[];
  league: League;
}

function getPaymentIcon(type: string) {
  switch (type) {
    case 'credit_card':
    case 'square':
    case 'cardpointe':
      return CreditCard;
    case 'cash': return Banknote;
    case 'check': return FileText;
    default: return Receipt;
  }
}

function getPaymentMethodLabel(payment: Payment) {
  switch (payment.type) {
    case 'credit_card': return 'Credit Card';
    case 'square': return 'Square';
    case 'cardpointe': return 'CardPointe';
    case 'cash': return 'Cash';
    case 'check': return `Check #${payment.checkNumber || ''}`;
    default: return 'Other';
  }
}

function getStatusStyle(status: string) {
  switch (status) {
    case 'paid': return 'bg-emerald-50 text-emerald-700';
    case 'pending': return 'bg-blue-50 text-blue-700';
    case 'failed': return 'bg-amber-50 text-amber-700';
    case 'refunded': return 'bg-red-50 text-red-700';
    default: return 'bg-slate-100 text-slate-600';
  }
}

function getStatusLabel(status: string) {
  switch (status) {
    case 'paid': return 'Paid';
    case 'pending': return 'Pending';
    case 'failed': return 'Failed';
    case 'refunded': return 'Refunded';
    default: return status;
  }
}

export const BowlerPaymentTable: FC<BowlerPaymentTableProps> = ({ payments, league }) => {
  return (
    <div>
      <div className="flex items-center justify-between mb-3 px-1">
        <h3 className="text-lg font-semibold text-slate-800">Payment History</h3>
        <span className="text-sm text-slate-500">{payments.length} payment{payments.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {payments.length === 0 ? (
          <div className="p-8 text-center">
            <Receipt className="w-10 h-10 mx-auto mb-3 text-slate-300" />
            <p className="text-slate-500">No payments recorded</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {payments.map((payment) => {
              const Icon = getPaymentIcon(payment.type);
              const weekNumber = league.seasonStart
                ? Math.max(1, differenceInWeeks(new Date(payment.weekOf), new Date(league.seasonStart)) + 1)
                : null;

              return (
                <div key={payment.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-5 h-5 text-slate-500" />
                    </div>
                    <div>
                      <div className="font-semibold text-slate-900">{formatCurrency(payment.amount)}</div>
                      <div className="text-sm text-slate-500">
                        {format(new Date(payment.weekOf), 'MMM d, yyyy')}
                        {weekNumber && <> &bull; Week {weekNumber}</>}
                        {' '}&bull; {getPaymentMethodLabel(payment)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`px-2.5 py-1 rounded-md text-xs font-medium ${getStatusStyle(payment.status)}`}>
                      {getStatusLabel(payment.status)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
