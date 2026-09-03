-- Crea automáticamente la fila en public.profiles cuando nace un usuario
-- en auth.users (Supabase Auth). Sin esto, cada alta de usuario necesitaría
-- un segundo paso manual desde el cliente para crear su profile — y si ese
-- segundo paso fallara o se saltara, quedaría un usuario que puede
-- autenticarse pero no tiene profile ni puede pertenecer a ningún tenant.
-- Al vivir en un trigger de base de datos, pasa siempre, sin importar si
-- el alta vino de la app, del Studio, o de un script.
create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer -- necesario: escribe en public.profiles, que tiene RLS
set search_path = public, extensions
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    -- full_name viene de auth.users.raw_user_meta_data (lo que se pasa al
    -- crear el usuario, p. ej. { "full_name": "María Fernanda Ruiz" } en
    -- la semilla). Si no viene, se cae al correo, y si tampoco hay correo,
    -- a un texto genérico — nunca se deja NULL, porque profiles.full_name
    -- es NOT NULL.
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email, 'Sin nombre')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_auth_user();

comment on function app.handle_new_auth_user() is
  'Trigger AFTER INSERT en auth.users: crea el profile correspondiente en la misma transacción del alta.';
