import { Trophy, Target, TrendingUp, TrendingDown } from "lucide-react";

const rankingData = [
  {
    pos: "North Mall",
    goal: 75000,
    achieved: 82500,
    achievement: 110,
    status: "exceeded",
  },
  {
    pos: "Downtown Store",
    goal: 50000,
    achieved: 68000,
    achievement: 136,
    status: "exceeded",
  },
  {
    pos: "South District",
    goal: 45000,
    achieved: 47000,
    achievement: 104.4,
    status: "exceeded",
  },
  {
    pos: "East District",
    goal: 40000,
    achieved: 38000,
    achievement: 95,
    status: "not-achieved",
  },
  {
    pos: "South Mall",
    goal: 60000,
    achieved: 55000,
    achievement: 91.7,
    status: "not-achieved",
  },
  {
    pos: "West Store",
    goal: 35000,
    achieved: 28000,
    achievement: 80,
    status: "not-achieved",
  },
];

export function GoalsRanking() {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
    }).format(value);
  };

  const posAboveGoal = rankingData.filter((item) => item.achievement >= 100);
  const averageAchievement =
    rankingData.reduce((sum, item) => sum + item.achievement, 0) /
    rankingData.length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">
          Goals Achievement Ranking
        </h2>
        <p className="text-gray-600">
          Track the performance of each POS against established goals
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-2">
            <Trophy className="size-5 text-yellow-600" />
            <span className="text-sm font-medium text-gray-600">
              POS Above Goal
            </span>
          </div>
          <p className="text-3xl font-semibold text-gray-900">
            {posAboveGoal.length}
            <span className="text-lg text-gray-500 ml-2">
              of {rankingData.length}
            </span>
          </p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-2">
            <Target className="size-5 text-blue-600" />
            <span className="text-sm font-medium text-gray-600">
              Average Achievement
            </span>
          </div>
          <p className="text-3xl font-semibold text-gray-900">
            {averageAchievement.toFixed(1)}%
          </p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-2">
            <Trophy className="size-5 text-green-600" />
            <span className="text-sm font-medium text-gray-600">
              Best Performance
            </span>
          </div>
          <p className="text-xl font-semibold text-gray-900">
            {rankingData[0].pos}
          </p>
          <p className="text-sm text-green-600 font-medium">
            {rankingData[0].achievement}% of goal
          </p>
        </div>
      </div>

      {/* Ranking */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">
            Ranking by Achievement
          </h3>
        </div>

        <div className="divide-y divide-gray-200">
          {rankingData.map((item, index) => {
            const exceededGoal = item.achievement >= 100;
            const difference = item.achieved - item.goal;

            return (
              <div
                key={item.pos}
                className="px-6 py-5 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-4">
                    {/* Position */}
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg ${
                        index === 0
                          ? "bg-gradient-to-br from-yellow-400 to-yellow-600 text-white"
                          : index === 1
                          ? "bg-gradient-to-br from-gray-300 to-gray-500 text-white"
                          : index === 2
                          ? "bg-gradient-to-br from-orange-400 to-orange-600 text-white"
                          : "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {index + 1}
                    </div>

                    {/* POS Name */}
                    <div>
                      <h4 className="text-base font-semibold text-gray-900">
                        {item.pos}
                      </h4>
                      <div className="flex items-center gap-4 mt-1">
                        <span className="text-sm text-gray-500">
                          Goal: {formatCurrency(item.goal)}
                        </span>
                        <span className="text-sm text-gray-500">
                          Achieved: {formatCurrency(item.achieved)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Achievement */}
                  <div className="text-right">
                    <div
                      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-lg ${
                        exceededGoal
                          ? "bg-green-100 text-green-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {exceededGoal ? (
                        <TrendingUp className="size-5" />
                      ) : (
                        <TrendingDown className="size-5" />
                      )}
                      {item.achievement.toFixed(1)}%
                    </div>
                    <p
                      className={`text-sm mt-1 font-medium ${
                        exceededGoal ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {exceededGoal ? "+" : ""}
                      {formatCurrency(difference)}
                    </p>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      exceededGoal ? "bg-green-500" : "bg-red-500"
                    }`}
                    style={{
                      width: `${Math.min(item.achievement, 100)}%`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
