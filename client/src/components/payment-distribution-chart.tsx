"use client"

import * as React from "react"
import { CreditCard, DollarSign, FileCheck } from "lucide-react"
import { Pie, PieChart, Label } from "recharts"

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

export interface PaymentDistributionChartProps {
  payments: Array<{
    type: string;
    status: string;
  }>;
  activeBowlersCount: number;
}

export function PaymentDistributionChart({ payments, activeBowlersCount }: PaymentDistributionChartProps) {
  // Count payments by type
  const paymentCounts = React.useMemo(() => {
    // Only consider paid payments
    const paidPayments = payments.filter(payment => payment.status === 'paid');
    
    // Count by type
    const counts = {
      credit_card: 0,
      cash: 0,
      check: 0
    };
    
    paidPayments.forEach(payment => {
      if (payment.type === 'credit_card') counts.credit_card++;
      else if (payment.type === 'cash') counts.cash++;
      else if (payment.type === 'check') counts.check++;
    });
    
    return counts;
  }, [payments]);
  
  // Create chart data
  const chartData = React.useMemo(() => {
    const totalPayments = paymentCounts.credit_card + paymentCounts.cash + paymentCounts.check;
    
    // Filter out zero values so they don't appear in the chart
    const data = [
      { 
        type: "credit_card", 
        count: paymentCounts.credit_card,
        percentage: totalPayments > 0 ? Math.round((paymentCounts.credit_card / totalPayments) * 100) : 0,
        percent: totalPayments > 0 ? (paymentCounts.credit_card / totalPayments) : 0,
        fill: "#3b82f6" // blue-500 for credit cards
      },
      { 
        type: "cash", 
        count: paymentCounts.cash,
        percentage: totalPayments > 0 ? Math.round((paymentCounts.cash / totalPayments) * 100) : 0, 
        percent: totalPayments > 0 ? (paymentCounts.cash / totalPayments) : 0,
        fill: "#10b981" // emerald-500 for cash
      },
      { 
        type: "check", 
        count: paymentCounts.check,
        percentage: totalPayments > 0 ? Math.round((paymentCounts.check / totalPayments) * 100) : 0, 
        percent: totalPayments > 0 ? (paymentCounts.check / totalPayments) : 0,
        fill: "#d946ef" // fuchsia-500 for checks
      }
    ];
    
    // Only return payment types with non-zero counts
    return data.filter(item => item.count > 0);
  }, [paymentCounts]);

  const chartConfig = {
    count: {
      label: "Count",
    },
    credit_card: {
      label: "Credit Card",
      color: "#3b82f6", // blue-500 for credit cards
      icon: CreditCard,
    },
    cash: {
      label: "Cash",
      color: "#10b981", // emerald-500 for cash
      icon: DollarSign,
    },
    check: {
      label: "Check",
      color: "#d946ef", // fuchsia-500 for checks
      icon: FileCheck,
    },
  } satisfies ChartConfig;

  return (
    <Card className="flex flex-col">
      <CardHeader className="items-center pb-2">
        <CardTitle>Payment Methods</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 pb-0">
        <ChartContainer
          config={chartConfig}
          className="mx-auto w-full h-[300px]"
        >
          <PieChart>
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel />}
            />
            <Pie
              data={chartData}
              dataKey="count"
              nameKey="type"
              innerRadius={65}
              strokeWidth={0}
              outerRadius={110}
              label={({ type, percentage }) => {
                return percentage > 0 ? (
                  <text 
                    x="50%" 
                    y="50%" 
                    textAnchor="middle" 
                    dominantBaseline="middle"
                    fill="white"
                    fontWeight="bold"
                    fontSize="12px"
                  >
                    {`${percentage}%`}
                  </text>
                ) : "";
              }}
              labelLine={false}
              paddingAngle={0}
            >
              <Label
                content={({ viewBox }) => {
                  if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                    return (
                      <text
                        x={viewBox.cx}
                        y={viewBox.cy}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        <tspan
                          x={viewBox.cx}
                          y={viewBox.cy}
                          className="fill-foreground text-3xl font-bold"
                        >
                          {activeBowlersCount}
                        </tspan>
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy || 0) + 24}
                          className="fill-muted-foreground text-sm"
                        >
                          Active Bowlers
                        </tspan>
                      </text>
                    )
                  }
                }}
              />
            </Pie>

          </PieChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}