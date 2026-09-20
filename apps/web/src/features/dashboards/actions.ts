import { Schema } from "effect";
import {
  DashboardCalories,
  DashboardDate,
  DashboardItemLabel,
  DashboardKey,
  WeatherLocationId,
  WeatherUnit,
} from "./schema";

const common = {
  key: DashboardKey,
  expectedRevision: Schema.NonNegativeInt.pipe(Schema.greaterThan(0)),
  blockId: DashboardKey,
  id: Schema.UUID,
};
export const DashboardAction = Schema.Union(
  Schema.Struct({
    ...common,
    action: Schema.Literal("add-todo"),
    label: DashboardItemLabel,
  }),
  Schema.Struct({
    ...common,
    action: Schema.Literal("set-todo"),
    done: Schema.Boolean,
  }),
  Schema.Struct({ ...common, action: Schema.Literal("delete-todo") }),
  Schema.Struct({
    ...common,
    action: Schema.Literal("add-meal"),
    date: DashboardDate,
    label: DashboardItemLabel,
    calories: DashboardCalories,
  }),
  Schema.Struct({ ...common, action: Schema.Literal("delete-meal") }),
  Schema.Struct({
    ...common,
    action: Schema.Literal("set-weather-unit"),
    unit: WeatherUnit,
  }),
);
export type DashboardAction = typeof DashboardAction.Type;
export const decodeDashboardAction = Schema.decodeUnknownSync(DashboardAction, {
  onExcessProperty: "error",
});

export type DashboardContentAction = DashboardAction;
const trackerFields = {
  key: DashboardKey,
  title: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(100)),
};
export const CreateWeatherTracker = Schema.Struct({
  ...trackerFields,
  kind: Schema.Literal("weather"),
  locationId: WeatherLocationId,
  unit: WeatherUnit,
});
export const CreateDashboardTracker = Schema.Union(
  Schema.Struct({ ...trackerFields, kind: Schema.Literal("todo") }),
  Schema.Struct({ ...trackerFields, kind: Schema.Literal("calories") }),
  CreateWeatherTracker,
);
export type CreateDashboardTracker = typeof CreateDashboardTracker.Type;
export const decodeCreateDashboardTracker = Schema.decodeUnknownSync(
  CreateDashboardTracker,
  {
    onExcessProperty: "error",
  },
);
