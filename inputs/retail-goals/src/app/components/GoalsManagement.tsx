import { useState } from "react";
import { Plus, Save, Trash2, Calculator, TrendingUp } from "lucide-react";

interface Goal {
  id: string;
  pos: string;
  month: string;
  target: number;
  basePeriod?: string;
  baseValue?: number;
  growthType?: "percentage" | "absolute";
  growthValue?: number;
}

// List of available POS (previously added)
const availablePOS = [
  "Downtown Store",
  "North Mall",
  "South District",
  "East District",
  "South Mall",
  "West Store",
  "North District",
  "East Mall",
];

// Mock historical sales data by POS
const historicalSales: Record<string, Record<string, number>> = {
  "Downtown Store": {
    "2026-01": 48000,
    "2025-02": 42000,
  },
  "North Mall": {
    "2026-01": 72000,
    "2025-02": 65000,
  },
  "South District": {
    "2026-01": 43000,
    "2025-02": 38000,
  },
  "East District": {
    "2026-01": 36000,
    "2025-02": 34000,
  },
  "South Mall": {
    "2026-01": 58000,
    "2025-02": 52000,
  },
  "West Store": {
    "2026-01": 26000,
    "2025-02": 24000,
  },
};

export function GoalsManagement() {
  const [goals, setGoals] = useState<Goal[]>([
    {
      id: "1",
      pos: "Downtown Store",
      month: "2026-02",
      target: 50000,
      basePeriod: "previous-month",
      baseValue: 48000,
      growthType: "percentage",
      growthValue: 4.17,
    },
    {
      id: "2",
      pos: "North Mall",
      month: "2026-02",
      target: 75000,
      basePeriod: "previous-month",
      baseValue: 72000,
      growthType: "percentage",
      growthValue: 4.17,
    },
  ]);

  const [newGoal, setNewGoal] = useState<Partial<Goal>>({
    pos: "",
    month: "2026-02",
    target: 0,
    basePeriod: "previous-month",
    baseValue: 0,
    growthType: "percentage",
    growthValue: 0,
  });

  const [useCalculator, setUseCalculator] = useState(false);

  // Function to get base period based on selection
  const getBasePeriod = (currentMonth: string, periodType: string, customPeriod?: string) => {
    if (periodType === "custom" && customPeriod) {
      return customPeriod;
    }

    const [year, month] = currentMonth.split("-").map(Number);
    const date = new Date(year, month - 1);

    if (periodType === "previous-month") {
      date.setMonth(date.getMonth() - 1);
    } else if (periodType === "previous-year") {
      date.setFullYear(date.getFullYear() - 1);
    }

    const resultYear = date.getFullYear();
    const resultMonth = String(date.getMonth() + 1).padStart(2, "0");
    return `${resultYear}-${resultMonth}`;
  };

  // Function to get historical sales
  const getHistoricalSales = (pos: string, period: string): number => {
    return historicalSales[pos]?.[period] || 0;
  };

  // Calculate target based on period and growth
  const calculateTarget = () => {
    if (!newGoal.pos || !newGoal.month) return;

    const basePeriod = getBasePeriod(
      newGoal.month,
      newGoal.basePeriod || "previous-month"
    );
    const baseValue = getHistoricalSales(newGoal.pos, basePeriod);

    let calculatedTarget = baseValue;

    if (newGoal.growthType === "percentage") {
      calculatedTarget = baseValue * (1 + (newGoal.growthValue || 0) / 100);
    } else {
      calculatedTarget = baseValue + (newGoal.growthValue || 0);
    }

    setNewGoal({
      ...newGoal,
      baseValue: baseValue,
      target: Math.round(calculatedTarget),
    });
  };

  const handleAddGoal = () => {
    if (newGoal.pos && newGoal.target && newGoal.target > 0) {
      const goal: Goal = {
        id: Date.now().toString(),
        pos: newGoal.pos,
        month: newGoal.month || "2026-02",
        target: newGoal.target,
        basePeriod: newGoal.basePeriod,
        baseValue: newGoal.baseValue,
        growthType: newGoal.growthType,
        growthValue: newGoal.growthValue,
      };
      setGoals([...goals, goal]);
      setNewGoal({
        pos: "",
        month: "2026-02",
        target: 0,
        basePeriod: "previous-month",
        baseValue: 0,
        growthType: "percentage",
        growthValue: 0,
      });
      setUseCalculator(false);
    }
  };

  const handleDeleteGoal = (id: string) => {
    setGoals(goals.filter((g) => g.id !== id));
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  };

  const formatNumber = (value: number) => {
    return new Intl.NumberFormat("en-US").format(value);
  };

  const formatMonth = (monthStr: string) => {
    const [year, month] = monthStr.split("-");
    const date = new Date(parseInt(year), parseInt(month) - 1);
    return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  };

  const handleTargetInput = (value: string) => {
    // Remove everything except numbers
    const numericValue = value.replace(/\D/g, "");
    const numValue = numericValue ? parseInt(numericValue) : 0;
    setNewGoal({ ...newGoal, target: numValue });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">
          Monthly Goals Management
        </h2>
        <p className="text-gray-600">
          Set sales goals for each POS of your merchant
        </p>
      </div>

      {/* New Goal Form */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
          <Plus className="size-5 text-green-600" />
          Add New Goal
        </h3>

        <div className="space-y-4">
          {/* Row 1: POS and Month */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select POS *
              </label>
              <select
                value={newGoal.pos}
                onChange={(e) => setNewGoal({ ...newGoal, pos: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
              >
                <option value="">Choose a POS</option>
                {availablePOS.map((pos) => (
                  <option key={pos} value={pos}>
                    {pos}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Reference Month *
              </label>
              <input
                type="month"
                value={newGoal.month}
                onChange={(e) =>
                  setNewGoal({ ...newGoal, month: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>

          {/* Goal Calculator */}
          <div className="border-t border-gray-200 pt-4">
            <div className="flex items-center gap-2 mb-4">
              <input
                type="checkbox"
                id="use-calculator"
                checked={useCalculator}
                onChange={(e) => setUseCalculator(e.target.checked)}
                className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
              />
              <label
                htmlFor="use-calculator"
                className="text-sm font-medium text-gray-700 flex items-center gap-2 cursor-pointer"
              >
                <Calculator className="size-4 text-green-600" />
                Calculate goal based on previous period
              </label>
            </div>

            {useCalculator && (
              <div className="bg-green-50 rounded-lg p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Base Period
                    </label>
                    <select
                      value={newGoal.basePeriod}
                      onChange={(e) =>
                        setNewGoal({ ...newGoal, basePeriod: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                    >
                      <option value="previous-month">Previous Month</option>
                      <option value="previous-year">Previous Year</option>
                      <option value="custom">Custom Period</option>
                    </select>
                  </div>

                  {newGoal.basePeriod === "custom" && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Custom Period
                      </label>
                      <input
                        type="month"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                      />
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Growth Type
                    </label>
                    <select
                      value={newGoal.growthType}
                      onChange={(e) =>
                        setNewGoal({
                          ...newGoal,
                          growthType: e.target.value as "percentage" | "absolute",
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                    >
                      <option value="percentage">Percentage (%)</option>
                      <option value="absolute">Absolute Value ($)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {newGoal.growthType === "percentage"
                        ? "Growth (%)"
                        : "Growth ($)"}
                    </label>
                    <input
                      type="number"
                      step={newGoal.growthType === "percentage" ? "0.1" : "1"}
                      value={newGoal.growthValue || ""}
                      onChange={(e) =>
                        setNewGoal({
                          ...newGoal,
                          growthValue: parseFloat(e.target.value) || 0,
                        })
                      }
                      placeholder={newGoal.growthType === "percentage" ? "5" : "5000"}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                </div>

                <button
                  onClick={calculateTarget}
                  disabled={!newGoal.pos || !newGoal.month}
                  className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  <TrendingUp className="size-4" />
                  Calculate Goal
                </button>

                {newGoal.baseValue && newGoal.baseValue > 0 && (
                  <div className="bg-white rounded-lg p-4 border border-green-200">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-gray-600">Base Period Sales:</p>
                        <p className="font-semibold text-gray-900">
                          {formatCurrency(newGoal.baseValue)}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-600">Calculated Goal:</p>
                        <p className="font-semibold text-green-600">
                          {formatCurrency(newGoal.target || 0)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Manual or Calculated Goal */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Sales Goal ($) *
            </label>
            <input
              type="text"
              value={newGoal.target ? formatNumber(newGoal.target) : ""}
              onChange={(e) => handleTargetInput(e.target.value)}
              placeholder="50,000"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Enter the value without symbols. Ex: 50000 or 50,000
            </p>
          </div>

          <button
            onClick={handleAddGoal}
            disabled={!newGoal.pos || !newGoal.target || newGoal.target <= 0}
            className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            <Save className="size-4" />
            Save Goal
          </button>
        </div>
      </div>

      {/* Goals List */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">Registered Goals</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  POS
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Month
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Base
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Goal
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {goals.map((goal) => (
                <tr key={goal.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {goal.pos}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    {formatMonth(goal.month)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    {goal.baseValue ? (
                      <div>
                        <p className="text-xs text-gray-500">
                          {goal.basePeriod === "previous-month"
                            ? "Previous month"
                            : goal.basePeriod === "previous-year"
                            ? "Previous year"
                            : "Custom"}
                        </p>
                        <p className="font-medium">
                          {formatCurrency(goal.baseValue)}
                          {goal.growthType && goal.growthValue && (
                            <span className="text-green-600 ml-1">
                              +
                              {goal.growthType === "percentage"
                                ? `${goal.growthValue.toFixed(1)}%`
                                : formatCurrency(goal.growthValue)}
                            </span>
                          )}
                        </p>
                      </div>
                    ) : (
                      <span className="text-gray-400">Manual</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                    {formatCurrency(goal.target)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                    <button
                      onClick={() => handleDeleteGoal(goal.id)}
                      className="text-red-600 hover:text-red-800 transition-colors"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {goals.length === 0 && (
          <div className="px-6 py-12 text-center text-gray-500">
            No goals registered yet. Add your first goal above.
          </div>
        )}
      </div>
    </div>
  );
}
