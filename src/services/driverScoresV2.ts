import { supabase } from "@/lib/supabase";
import type { 
  DriverScoreVehicleSummary, 
  VehicleScoreCalendarDay, 
  VehicleScoreDayDetail 
} from "@/types/driverScoresV2";

export const driverScoresService = {
  /**
   * Fetches the fleet summary from the driver_score_vehicle_summary view.
   */
  async getFleetSummary(): Promise<{ data: DriverScoreVehicleSummary[] | null; error: any }> {
    const { data, error } = await supabase
      .from('driver_score_vehicle_summary')
      .select('*')
      .order('ui_bucket', { ascending: true })
      .order('latest_score', { ascending: false });

    return { data: data as DriverScoreVehicleSummary[], error };
  },

  /**
   * Fetches the 30-day calendar for a specific vehicle.
   */
  async getVehicleCalendar(tracker_id: string, days: number = 30): Promise<{ data: VehicleScoreCalendarDay[] | null; error: any }> {
    const { data, error } = await supabase
      .rpc('get_vehicle_score_calendar', { 
        p_tracker_id: parseInt(tracker_id), 
        p_days: days 
      });

    return { data: data as VehicleScoreCalendarDay[], error };
  },

  /**
   * Fetches the detail for a specific vehicle on a specific day.
   */
  async getDayDetail(tracker_id: string, selected_date: string): Promise<{ data: VehicleScoreDayDetail | null; error: any }> {
    const { data, error } = await supabase
      .rpc('get_vehicle_score_day_detail', { 
        p_tracker_id: parseInt(tracker_id), 
        p_date: selected_date 
      });

    // RPC returns an array of 1 element usually, or the object directly depending on how it's written.
    // Assuming it returns a single object based on the name 'day_detail'.
    const detail = Array.isArray(data) ? data[0] : data;

    return { data: detail as VehicleScoreDayDetail, error };
  }
};
