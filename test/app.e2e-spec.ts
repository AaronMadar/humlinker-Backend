import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { API_PREFIX, API_VERSION } from '../src/common';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(`${API_PREFIX}/${API_VERSION}`);
    await app.init();
  });

  it(`/api/${API_VERSION}/health (GET)`, () => {
    return request(app.getHttpServer())
      .get(`/${API_PREFIX}/${API_VERSION}/health`)
      .expect(200)
      .expect((res) => {
        expect(res.body.success).toBe(true);
        expect(res.body.data).toEqual({ status: 'ok' });
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
