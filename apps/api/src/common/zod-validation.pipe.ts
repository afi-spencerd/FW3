import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from "@nestjs/common";
import type { ZodType, ZodTypeDef } from "zod";

/**
 * Validate request payloads against a shared zod schema (from @fw3/shared-types).
 * One validation story across the API and the web client — no class-validator.
 *
 * TIn is inferred from the schema so schemas with defaults/transforms (where the
 * parsed input shape differs from the output) still type-check.
 */
@Injectable()
export class ZodValidationPipe<TOut, TIn = unknown>
  implements PipeTransform<unknown, TOut>
{
  constructor(private readonly schema: ZodType<TOut, ZodTypeDef, TIn>) {}

  transform(value: unknown): TOut {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: "Validation failed",
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
