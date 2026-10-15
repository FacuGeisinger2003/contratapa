# Contratapa

Web para registrar los libros que leíste, ordenados por género, con la contratapa, puntajes, tus números del año, amigos, recomendaciones y dónde conseguir cada libro en Uruguay.

Hecha con HTML + JavaScript (sin instalar nada), **Supabase** (cuentas y base de datos) y **Google Books** (contratapas y portadas).

## Publicarla (unos 15 minutos)

### 1. Supabase: cuentas y base de datos
1. Entrá a https://supabase.com, creá una cuenta y un **New project** (región: São Paulo). Guardá la contraseña de la base.
2. Andá a **SQL Editor → New query**, pegá todo el archivo `supabase/schema.sql` y tocá **Run**. Tiene que decir "Success".
3. Andá a **Project Settings → API** y copiá:
   - **Project URL**
   - la clave **anon public**
4. Pegalas en `config.js`.

### 2. GitHub
1. Creá un repositorio nuevo (por ejemplo `contratapa`) en https://github.com/new.
2. Tocá **uploading an existing file** y arrastrá todos los archivos de esta carpeta (incluida la carpeta `supabase`). **Commit changes**.

### 3. Vercel
1. Entrá a https://vercel.com con tu cuenta de GitHub.
2. **Add New → Project**, elegí el repo `contratapa` y tocá **Deploy** (no hay que configurar nada).
3. Te da una dirección tipo `https://contratapa.vercel.app`.

### 4. Conectar la dirección en Supabase
En Supabase → **Authentication → URL Configuration**:
- **Site URL**: tu dirección de Vercel (ej. `https://contratapa.vercel.app`)
- **Redirect URLs**: agregá la misma dirección.

Esto hace que los mails de confirmación y de "olvidé mi contraseña" lleven a tu web.

¡Listo! Mandá el link a tus amigos.

## Cómo funciona
- **Registro:** nombre, usuario (@facu), mail y contraseña. Supabase manda un mail para confirmar la cuenta.
- **Amigos:** se buscan por usuario y hay que aceptar la solicitud. Solo tus amigos ven tu estante.
- **Recomendaciones:** solo se pueden mandar a amigos.
- **Seguridad:** las reglas de la base (RLS en `schema.sql`) hacen que cada uno solo pueda editar lo suyo.

## Notas
- El plan gratis de Supabase manda pocos mails por hora. Para probar con amigos alcanza; si crece, se configura un servicio de mail propio (Resend, por ejemplo).
- Para cambiar algo, editá los archivos en GitHub: Vercel vuelve a publicar solo.
