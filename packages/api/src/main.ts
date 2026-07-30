import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // The dashboard is served from its own origin (the Angular dev server in
  // development, a separate static host in deployment), so every call it makes
  // to the control plane is cross-origin. Without this the browser blocks the
  // intake POST at preflight and the operator sees "Failed to fetch" — a bug no
  // jsdom component test can reproduce, because jsdom does not enforce CORS.
  //
  // Left open here deliberately: this is the functional slice, and the security
  // boundary (who may call the control plane, and from where) is explicitly out
  // of scope until that phase is opened. Narrow it to the dashboard's origin
  // then — do not leave this as-is once security is in scope.
  app.enableCors({ origin: true, credentials: true });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
