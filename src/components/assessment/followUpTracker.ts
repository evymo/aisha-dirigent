import type { Dimension, FollowUpResponse } from "./types";

/**
 * Factory function to create a follow-up state tracker
 * Used for managing follow-up question responses during assessment
 */
export function createFollowUpTracker() {
  const responses: Map<string, FollowUpResponse> = new Map();
  
  return {
    setResponse(tagId: string, response: boolean, dimension: Dimension, parentTagId: string) {
      responses.set(tagId, { tagId, response, dimension, parentTagId });
    },
    
    getResponse(tagId: string): boolean | undefined {
      return responses.get(tagId)?.response;
    },
    
    getPositiveResponses(): FollowUpResponse[] {
      return Array.from(responses.values()).filter(r => r.response);
    },
    
    getNegativeResponses(): FollowUpResponse[] {
      return Array.from(responses.values()).filter(r => !r.response);
    },

    getResponsesForDimension(dimension: Dimension): FollowUpResponse[] {
      return Array.from(responses.values()).filter(r => r.dimension === dimension);
    },
    
    clearDimension(dimension: Dimension) {
      for (const [key, value] of responses.entries()) {
        if (value.dimension === dimension) {
          responses.delete(key);
        }
      }
    },
    
    reset() {
      responses.clear();
    },
  };
}

export type { FollowUpResponse };
