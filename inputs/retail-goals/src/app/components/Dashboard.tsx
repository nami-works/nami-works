import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { TrendingUp, DollarSign, Store, Award } from "lucide-react";

const salesData = [
  { pos: "North Mall", sales: 82500, goal: 75000 },
  { pos: "Downtown Store", sales: 68000, goal: 50000 },
  { pos: "South Mall", sales: 55000, goal: 60000 },
  { pos: "South District", sales: 47000, goal: 45000 },
  { pos: "East District", sales: 38000, goal: 40000 },
];

const topSellers = [
  { name: "Maria Silva", sales: 125000, deals: 48 },
  { name: "João Santos", sales: 112000, deals: 42 },
  { name: "Ana Costa", sales: 98000, deals: 38 },
  { name: "Carlos Souza", sales: 87000, deals: 35 },
  { name: "Paula Lima", sales: 76000, deals: 29 },
];

export function Dashboard() {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
    }).format(value);
  };

  const totalSales = salesData.reduce((sum, item) => sum + item.sales, 0);
  const totalGoal = salesData.reduce((sum, item) => sum + item.goal, 0);
  const achievementRate = ((totalSales / totalGoal) * 100).toFixed(1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">
          Sales Dashboard
        </h2>
        <p className="text-gray-600">February 2026</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-600">
              Total Sales
            </span>
            <DollarSign className="size-5 text-green-600" />
          </div>
          <p className="text-2xl font-semibold text-gray-900">
            {formatCurrency(totalSales)}
          </p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-600">Total Goal</span>
            <Store className="size-5 text-blue-600" />
          </div>
          <p className="text-2xl font-semibold text-gray-900">
            {formatCurrency(totalGoal)}
          </p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-600">
              Achievement Rate
            </span>
            <Award className="size-5 text-purple-600" />
          </div>
          <p className="text-2xl font-semibold text-gray-900">
            {achievementRate}%
          </p>
        </div>
      </div>

      {/* Sales Ranking Chart */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-6 flex items-center gap-2">
          <TrendingUp className="size-5 text-green-600" />
          Sales Ranking by POS
        </h3>

        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={salesData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="pos"
              tick={{ fontSize: 12 }}
              stroke="#6b7280"
            />
            <YAxis
              tick={{ fontSize: 12 }}
              stroke="#6b7280"
              tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
            />
            <Tooltip
              formatter={(value: number) => formatCurrency(value)}
              contentStyle={{
                backgroundColor: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
              }}
            />
            <Legend />
            <Bar dataKey="sales" fill="#16a34a" name="Actual Sales" />
            <Bar dataKey="goal" fill="#3b82f6" name="Goal" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Top Sellers */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">
            Top Sellers of the Month
          </h3>
        </div>

        <div className="divide-y divide-gray-200">
          {topSellers.map((seller, index) => (
            <div
              key={seller.name}
              className="px-6 py-4 flex items-center justify-between hover:bg-gray-50"
            >
              <div className="flex items-center gap-4">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold text-sm ${
                    index === 0
                      ? "bg-yellow-100 text-yellow-700"
                      : index === 1
                      ? "bg-gray-100 text-gray-700"
                      : index === 2
                      ? "bg-orange-100 text-orange-700"
                      : "bg-blue-50 text-blue-700"
                  }`}
                >
                  {index + 1}
                </div>
                <div>
                  <p className="font-medium text-gray-900">{seller.name}</p>
                  <p className="text-sm text-gray-500">{seller.deals} sales</p>
                </div>
              </div>
              <p className="font-semibold text-gray-900">
                {formatCurrency(seller.sales)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
