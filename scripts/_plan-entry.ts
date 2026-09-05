/** verify-plan.mjs 用の入口。DB を通さずロジックだけを束ねる */
export { BUILTIN_INGREDIENTS } from '../src/db/data/ingredients';
export { BUILTIN_RECIPES } from '../src/db/data/recipes';
export { buildRecipe } from '../src/db/data/build';
export { solveWithRequest, applyRequest } from '../src/features/planner/logic/request';
export { solveWeek } from '../src/features/planner/logic/solver';
export { timeMetric, perDayMinutes } from '../src/features/planner/logic/time';
export { buildDailyMenus } from '../src/features/planner/logic/distribute';
