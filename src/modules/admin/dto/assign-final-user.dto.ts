import { IsOptional, IsUUID } from 'class-validator';

export class AssignFinalUserDto {
  @IsOptional()
  @IsUUID('4', { message: 'El usuario final seleccionado no es valido' })
  finalUserId?: string | null;
}
