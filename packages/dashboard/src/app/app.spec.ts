import { TestBed } from '@angular/core/testing';

import { App } from './app';

/**
 * The shell is deliberately empty: it routes, and Mission Control renders.
 * (The P0 scaffold asserted on the Angular welcome page, which P12 replaced.)
 */
describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  });

  it('creates the app shell', () => {
    expect(TestBed.createComponent(App).componentInstance).toBeTruthy();
  });

  it('renders a router outlet rather than any content of its own', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('router-outlet')).toBeTruthy();
  });
});
