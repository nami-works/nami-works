import { TrendingUp, User } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const ticketData = [
  {
    seller: "Maria Silva",
    averageTicket: 2604,
    totalSales: 125000,
    numberOfSales: 48,
  },
  {
    seller: "João Santos",
    averageTicket: 2667,
    totalSales: 112000,
    numberOfSales: 42,
  },
  {
    seller: "Ana Costa",
    averageTicket: 2579,
    totalSales: 98000,
    numberOfSales: 38,
  },
  {
    seller: "Carlos Souza",
    averageTicket: 2486,
    totalSales: 87000,
    numberOfSales: 35,
  },
  {
    seller: "Paula Lima",
    averageTicket: 2621,
    totalSales: 76000,
    numberOfSales: 29,
  },
  {
    seller: "Roberto Alves",
    averageTicket: 2344,
    totalSales: 65000,
    numberOfSales: 28,
  },
  {
    seller: "Fernanda Dias",
    averageTicket: 2429,
    totalSales: 58000,
    numberOfSales: 24,
  },
  {
    seller: "Lucas Pereira",
    averageTicket: 2222,
    totalSales: 44000,
    numberOfSales: 20,
  },
];

export function AverageTicket() {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  };

  const overallAverage =
    ticketData.reduce((sum, item) => sum + item.averageTicket, 0) /
    ticketData.length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">
          Average Order Value by Seller
        </h2>
        <p className="text-gray-600">
          Analysis of average transaction value for each seller
        </p>
      </div>

      {/* Overall Average Card */}
      <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-lg p-6 text-white">
        <div className="flex items-center gap-3 mb-2">
          <TrendingUp className="size-6" />
          <span className="text-lg font-medium">Overall Average Order Value</span>
        </div>
        <p className="text-4xl font-bold">{formatCurrency(overallAverage)}</p>
      </div>

      {/* Average Ticket Chart */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-6">
          Average Order Value Comparison
        </h3>

        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={ticketData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              type="number"
              tick={{ fontSize: 12 }}
              stroke="#6b7280"
              tickFormatter={(value) => formatCurrency(value)}
            />
            <YAxis
              dataKey="seller"
              type="category"
              width={120}
              tick={{ fontSize: 12 }}
              stroke="#6b7280"
            />
            <Tooltip
              formatter={(value: number) => formatCurrency(value)}
              contentStyle={{
                backgroundColor: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
              }}
            />
            <Bar dataKey="averageTicket" fill="#16a34a" name="Average Order Value" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Detailed Table */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">
            Breakdown by Seller
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Seller
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  # Sales
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Total Sales
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  AOV
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {ticketData.map((item) => (
                <tr key={item.seller} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                        <User className="size-4 text-green-600" />
                      </div>
                      <span className="text-sm font-medium text-gray-900">
                        {item.seller}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-600">
                    {item.numberOfSales}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-900">
                    {formatCurrency(item.totalSales)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <span
                      className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                        item.averageTicket > overallAverage
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {formatCurrency(item.averageTicket)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}